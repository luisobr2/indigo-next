/**
 * Invoice tools for the MCP: the invoicing the office does from Billing
 * (src/app/(app)/billing/invoices), for the agent. Four reads
 * (orders_to_invoice, find_invoices, get_invoice, invoice_pdf_link) and seven
 * writes (create_invoice, update_invoice, delete_invoice, issue_invoice,
 * void_invoice, record_payment, send_invoice).
 *
 * Every call goes to the Odoo service `indigo.billing` (addon
 * models/indigo_invoicing.py), the same one the panel's /api/invoicing
 * routes call. That service holds the rules — role (office/manager), one
 * live invoice per order, only invoice products, numbering that follows
 * QuickBooks, no void with payments, no overpayment — so this file does not
 * re-implement them. It adds what an agent needs on top: a preview written
 * for a person, argument checks with Spanish errors, and the same
 * preview -> confirm handshake as every other write tool (./write.ts).
 *
 * Calls carry `indigo_origin: "mcp"` in the Odoo context, so the invoice's
 * and its orders' history say the AI assistant did it.
 *
 * send_invoice is the one tool that reaches the dealer. It goes through the
 * same preview -> confirm as the rest, names every recipient in the preview,
 * and never sends a draft: what reaches a dealer always has a number.
 */
import type { McpIdentity } from "./token.ts";
import type { ToolDef } from "./tools.ts";
import { mcpError } from "./errors.ts";
import { CONFIRM_SCHEMA_PROPERTY, requireOfficeRole, runWriteTool, type WritePlan } from "./write.ts";
import { shopDateString } from "../shop-time.ts";
import { issuePdfLink, PDF_LINK_TTL_SECONDS } from "./oauth.ts";
import {
  draftTotals,
  parseEmails,
  PRODUCT_OPTIONS,
  type BillingStatus,
  type DraftLine,
  type InvoiceDetail,
  type InvoicePreview,
  type InvoiceRow,
  type InvoiceSummary,
} from "../billing/invoice.ts";

// Lazy, like tools.ts: the `@/` alias doesn't resolve under plain `node --test`.
async function getRpc() {
  const { rpcExecuteKw } = await import("@/lib/odoo/rpc");
  return rpcExecuteKw;
}

/** Tells the addon the call came through the assistant (see `_by` there). */
const MCP_CONTEXT = { indigo_origin: "mcp" };

async function billing<T>(id: McpIdentity, method: string, args: unknown[] = []): Promise<T> {
  const execute = await getRpc();
  try {
    return await execute<T>(id.uid, id.apiKey, "indigo.billing", method, args, { context: MCP_CONTEXT });
  } catch (e) {
    throw billingRefusal(e);
  }
}

/**
 * The service answers a broken rule with a UserError / ValidationError whose
 * text says what is wrong ("IND/2026/01302 is already on #1366. Void or
 * delete that invoice before invoicing it again."). That is a refusal the
 * person can act on, not an Odoo failure, so it gets its own code. The text
 * comes in English; the agent says it in Spanish.
 */
export function billingRefusal(e: unknown): unknown {
  if (e instanceof Error && e.name === "OdooRpcError") {
    const err = e as Error & { errorName?: string };
    if (err.errorName === "odoo.exceptions.UserError" || err.errorName === "odoo.exceptions.ValidationError") {
      return mcpError(
        "RECHAZADO",
        `Odoo no lo permite: "${err.message}". Explícale el motivo a la persona con tus palabras y no repitas la misma llamada.`,
      );
    }
    if (err.errorName === "odoo.exceptions.AccessError") {
      return mcpError(
        "PERMISO_DENEGADO",
        "Esta cuenta no puede facturar. Solo oficina o gerencia facturan: pídeselo a alguien con ese rol.",
      );
    }
  }
  return e;
}

function notReady() {
  return mcpError(
    "NO_CONFIGURADO",
    "La facturación desde la app todavía no está activada. La activa un gerente en Settings → Invoicing (botón «Set up invoicing»). Hasta entonces las facturas se hacen en QuickBooks.",
  );
}

// ---------------------------------------------------------------------
// Pure helpers (unit tested in invoices.test.ts)
// ---------------------------------------------------------------------

/** "$1,284.00", the way the invoice prints it. */
export function usd(value: number): string {
  const n = Number(value) || 0;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}$${s}`;
}

const PRODUCT_BY_CODE = new Map(PRODUCT_OPTIONS.map((p) => [p.code, p]));
const PRODUCT_CODES = PRODUCT_OPTIONS.map((p) => p.code);
const MAX_LINES = 60;
const MAX_ORDERS = 20;

function invalid(message: string): never {
  throw mcpError("ENTRADA_INVALIDA", message);
}

function requireId(args: Record<string, unknown>, key: string, tool: string): number {
  const raw = args[key];
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    invalid(`${tool} requiere '${key}': el id numérico de una sola factura (búscalo con find_invoices).`);
  }
  return raw;
}

export function requireOrderIds(args: Record<string, unknown>, tool: string): number[] {
  const raw = args.order_ids;
  if (!Array.isArray(raw) || !raw.length) {
    invalid(`${tool} requiere 'order_ids': la lista de ids de orden a facturar (salen de orders_to_invoice).`);
  }
  if (raw.length > MAX_ORDERS) invalid(`Como mucho ${MAX_ORDERS} órdenes por factura.`);
  const ids = raw.map((v) => {
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) invalid("'order_ids' solo admite ids numéricos de orden.");
    return v;
  });
  return [...new Set(ids)];
}

export function optionalDate(args: Record<string, unknown>, key: string): string | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    invalid(`'${key}' tiene que ser una fecha AAAA-MM-DD, por ejemplo ${shopDateString(new Date())}.`);
  }
  return raw;
}

function optionalEnum<T extends string>(args: Record<string, unknown>, key: string, allowed: readonly T[], fallback: T): T {
  const raw = args[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    invalid(`'${key}' tiene que ser uno de: ${allowed.join(", ")}.`);
  }
  return raw as T;
}

function kindOf(code: string): DraftLine["kind"] {
  if (code.startsWith("IND-FEE-")) return "fee";
  if (code === "IND-OTHER") return "free";
  return "door";
}

/**
 * The lines an agent sends, checked and completed. A door or free line
 * carries the 7 % unless the dealer is exempt; a fee line never does —
 * `taxable` overrides that per line, the way the checkbox in the app's
 * editor does (a display line, say). Whatever ends up taxed is spelled out
 * in the preview, line by line, before anyone confirms.
 */
export function parseInvoiceLines(raw: unknown, orderIds: number[], taxExempt: boolean): DraftLine[] {
  if (!Array.isArray(raw) || !raw.length) invalid("'lines' tiene que ser una lista con al menos una línea.");
  if (raw.length > MAX_LINES) invalid(`Como mucho ${MAX_LINES} líneas por factura.`);
  return raw.map((item, i) => {
    const n = i + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid(`La línea ${n} no es un objeto.`);
    const ln = item as Record<string, unknown>;
    const code = ln.product_code;
    const product = typeof code === "string" ? PRODUCT_BY_CODE.get(code) : undefined;
    if (!product) invalid(`Línea ${n}: 'product_code' tiene que ser uno de ${PRODUCT_CODES.join(", ")}.`);
    const qty = ln.qty === undefined ? 1 : ln.qty;
    if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) invalid(`Línea ${n}: 'qty' tiene que ser un número mayor que 0.`);
    const price = ln.price_unit;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      invalid(`Línea ${n}: 'price_unit' es obligatorio y no puede ser negativo.`);
    }
    let orderId: number | false = false;
    if (ln.order_id !== undefined && ln.order_id !== null && ln.order_id !== false) {
      if (typeof ln.order_id !== "number" || !orderIds.includes(ln.order_id)) {
        invalid(`Línea ${n}: 'order_id' tiene que ser una de las órdenes de esta factura (${orderIds.join(", ")}).`);
      }
      orderId = ln.order_id;
    }
    if (ln.description !== undefined && typeof ln.description !== "string") invalid(`Línea ${n}: 'description' tiene que ser texto.`);
    if (ln.taxable !== undefined && typeof ln.taxable !== "boolean") invalid(`Línea ${n}: 'taxable' tiene que ser true o false.`);
    const kind = kindOf(product.code);
    const taxable = typeof ln.taxable === "boolean" ? ln.taxable : product.taxable && !taxExempt;
    return {
      order_id: orderId,
      kind,
      product_code: product.code,
      product_label: product.label,
      description: ((ln.description as string | undefined) ?? "").trim() || product.label,
      qty,
      price_unit: Math.round(price * 100) / 100,
      taxable,
    };
  });
}

/** What goes to Odoo for a line: only the fields the service reads. */
function toServiceLine(l: DraftLine) {
  return {
    order_id: l.order_id || false,
    product_code: l.product_code,
    description: l.description,
    qty: l.qty,
    price_unit: l.price_unit,
    taxable: l.taxable,
  };
}

/**
 * The lines and totals, one per row, for a person to check against what
 * they expect to bill. Tax per line is named ("+7 %" / "sin impuesto").
 */
export function describeLines(lines: DraftLine[], taxRate: number, orderNames: Record<number, string>): string {
  const rows = lines.map((l, i) => {
    const amount = Math.round(l.qty * l.price_unit * 100) / 100;
    const order = l.order_id ? ` · ${orderNames[l.order_id] ?? `orden ${l.order_id}`}` : "";
    const tax = l.taxable ? `+${taxRate} %` : "sin impuesto";
    return `  ${i + 1}. ${l.product_label}${order} · "${l.description}" · ${l.qty} x ${usd(l.price_unit)} = ${usd(amount)} · ${tax}`;
  });
  const t = draftTotals(lines, taxRate);
  rows.push(`  Subtotal ${usd(t.untaxed)} · Impuesto ${usd(t.tax)} · Total ${usd(t.total)}`);
  return rows.join("\n");
}

/** The service's preview warnings, in Spanish when we know their shape. */
export function warningsInSpanish(warnings: string[]): string[] {
  return warnings.map((w) => {
    let m = /^(.+?) has no distance range/.exec(w);
    if (m) return `${m[1]} no tiene rango de distancia (falta el ZIP o no se reconoce): el recargo se puso en región A, revísalo.`;
    m = /^(.+?) has no invoice email yet\.?$/.exec(w);
    if (m) return `${m[1]} no tiene correo de facturación todavía: no afecta al borrador, pero hará falta para enviarla desde la app.`;
    return w;
  });
}

const MAX_RECIPIENTS = 10;

/** Addresses the agent passes: each one has to be a real address. */
export function requireEmails(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length) invalid("'emails' tiene que ser una lista con al menos un correo.");
  const out: string[] = [];
  for (const v of raw) {
    const parsed = typeof v === "string" ? parseEmails(v) : [];
    if (parsed.length !== 1) invalid(`'${String(v)}' no es un correo válido. Pásalos de uno en uno en la lista 'emails'.`);
    if (!out.some((e) => e.toLowerCase() === parsed[0].toLowerCase())) out.push(parsed[0]);
  }
  if (out.length > MAX_RECIPIENTS) invalid(`Como mucho ${MAX_RECIPIENTS} destinatarios por envío.`);
  return out;
}

/** Same words the app shows: Balance due -> Open, Cancelled -> Void. */
export function statusWord(status: InvoiceRow["status"]): string {
  return status === "Balance due" ? "Open" : status === "Cancelled" ? "Void" : status;
}

function formatRow(r: InvoiceRow) {
  return {
    id: r.id,
    number: r.state !== "draft" ? r.name || null : null,
    status: statusWord(r.status),
    dealer: Array.isArray(r.dealer) ? r.dealer[1] : null,
    dealer_id: Array.isArray(r.dealer) ? r.dealer[0] : null,
    invoice_date: r.invoice_date || null,
    due_date: r.due_date || null,
    subtotal: r.untaxed,
    tax: r.tax,
    total: r.total,
    balance_due: r.residual,
    orders: r.order_names,
    sent: !!r.sent_at,
  };
}

function detailLines(inv: InvoiceDetail): DraftLine[] {
  return inv.lines.map((l) => ({
    order_id: l.order_id,
    kind: kindOf(l.product_code),
    product_code: l.product_code,
    product_label: l.product_label,
    description: l.description,
    qty: l.qty,
    price_unit: l.price_unit,
    taxable: l.taxable,
  }));
}

/** A draft is named by what it is: Odoo may give it a provisional name. */
function invoiceLabel(inv: Pick<InvoiceRow, "name" | "state" | "dealer">): string {
  const dealer = Array.isArray(inv.dealer) ? inv.dealer[1] : "sin dealer";
  return inv.state !== "draft" && inv.name ? `la factura #${inv.name} de ${dealer}` : `el BORRADOR de factura de ${dealer}`;
}

function ordersLabel(orders: Array<{ name: string; client_name: string }>): string {
  return orders.length ? orders.map((o) => `${o.name} (${o.client_name})`).join(", ") : "sin órdenes";
}

// ---------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------

const INVOICE_ID_PROPERTY = {
  type: "number",
  description: "The numeric id of ONE invoice (the `id` from find_invoices or get_invoice — not its printed number).",
};

const LINES_PROPERTY = {
  type: "array",
  description:
    "The invoice lines, as the FULL list (lines you leave out are removed). Start from the ones the preview or get_invoice returned and edit those.",
  items: {
    type: "object",
    properties: {
      product_code: {
        type: "string",
        enum: PRODUCT_CODES,
        description:
          "IND-SD / IND-DD / IND-SL: a single door, double door, door with sidelites. IND-FEE-A..D: the installation fee of that distance region. IND-OTHER: anything else (a display, extra production).",
      },
      description: { type: "string", description: "The text printed on the line (client, reference, PO...)." },
      qty: { type: "number", description: "Quantity, defaults to 1." },
      price_unit: { type: "number", description: "Unit price in USD, before tax." },
      taxable: {
        type: "boolean",
        description:
          "Whether the 7 % sales tax applies. Leave it out: doors and IND-OTHER are taxed unless the dealer is exempt, fees never are. Only set it when the person said so for that line.",
      },
      order_id: { type: "number", description: "The order this line bills, if any (one of the invoice's orders)." },
    },
    required: ["product_code", "price_unit"],
    additionalProperties: false,
  },
};

const WRITE_NOTE = " Office/manager only. Preview-then-confirm like every write tool here (see 'confirm').";

export const INVOICE_TOOL_DEFS: ToolDef[] = [
  {
    name: "orders_to_invoice",
    title: "Orders ready to invoice",
    description:
      "Lists the installed orders that are not on any invoice yet, grouped by dealer — the office's 'To invoice' list. Use it to find the order ids create_invoice needs. Also says whether invoicing from the app is switched on at all (`ready`). Office/manager only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "find_invoices",
    title: "Find invoices",
    description:
      "Lists invoices made in the app, newest first, with a summary of the issued ones in the filter (invoiced, sales tax, collected, still open). Filter by status, dealer, invoice date range or a search text (invoice number, dealer or client name). Invoices from QuickBooks are not here. Office/manager only.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "open", "overdue", "paid", "all"],
          description: "'open' = issued with a balance due (includes overdue); 'all' (default) also lists drafts and voided invoices.",
        },
        dealer_id: { type: "number", description: "Only this dealer's invoices (id from list_dealers)." },
        date_from: { type: "string", description: "Invoice date from, YYYY-MM-DD." },
        date_to: { type: "string", description: "Invoice date to, YYYY-MM-DD." },
        search: { type: "string", description: "Invoice number, dealer name or client name." },
        limit: {
          type: "number",
          description: "Maximum invoices to return. Defaults to 25, capped at 100. `total` and `truncated` tell you if there are more — page with `offset`.",
        },
        offset: { type: "number", description: "How many matching invoices to skip. Defaults to 0." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_invoice",
    title: "Read one invoice",
    description:
      "Reads ONE invoice in full: its lines (with product, description, price and whether each is taxed), totals, balance due, orders, payments, and who it was sent to. Read it before update_invoice, issue_invoice, void_invoice or record_payment. Office/manager only.",
    inputSchema: {
      type: "object",
      properties: { invoice_id: INVOICE_ID_PROPERTY },
      required: ["invoice_id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_invoice",
    title: "Create a draft invoice",
    description:
      "Creates a DRAFT invoice (no number yet, not sent) for one or more installed orders of the SAME dealer, like 'Create invoice' in the app. Without 'lines' it proposes them exactly as the app does: one line per door at the order's price, with the 7 % sales tax unless the dealer is exempt, plus each order's installation fee for its distance region, without tax. The preview returns those `lines`: to change a price or a description, or to add a free line (e.g. a display, IND-OTHER), call again with the full edited 'lines' list. The draft can be changed with update_invoice or deleted with delete_invoice; it only gets its number when issued with issue_invoice." +
      WRITE_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        order_ids: {
          type: "array",
          items: { type: "number" },
          description: "The orders to bill, all of the same dealer (ids from orders_to_invoice). At most 20.",
        },
        lines: LINES_PROPERTY,
        photos: {
          type: "string",
          enum: ["installation", "none"],
          description:
            "'installation' (default) attaches the photos taken since the installation date, as thumbnails under the totals, as the app does; 'none' attaches none.",
        },
        invoice_date: { type: "string", description: "Invoice date, YYYY-MM-DD. Defaults to today." },
        confirm: CONFIRM_SCHEMA_PROPERTY,
      },
      required: ["order_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "update_invoice",
    title: "Change a draft invoice",
    description:
      "Changes a DRAFT invoice: replaces its lines with the full list you pass (read them with get_invoice, edit, send them all back — lines left out are removed), and/or its photos or its date. An issued invoice can't be changed: void it with void_invoice and create the right one." +
      WRITE_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: INVOICE_ID_PROPERTY,
        lines: LINES_PROPERTY,
        photos: {
          type: "string",
          enum: ["keep", "installation", "none"],
          description: "'keep' (default) leaves the photos as they are; 'installation' resets them to the installation photos; 'none' removes them.",
        },
        invoice_date: { type: "string", description: "New invoice date, YYYY-MM-DD." },
        confirm: CONFIRM_SCHEMA_PROPERTY,
      },
      required: ["invoice_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_invoice",
    title: "Delete a draft invoice",
    description:
      "Deletes a DRAFT invoice that was never issued; its orders go back to the 'To invoice' list. It has no number, so nothing is skipped in the numbering. An issued invoice can't be deleted — void it with void_invoice." +
      WRITE_NOTE,
    inputSchema: {
      type: "object",
      properties: { invoice_id: INVOICE_ID_PROPERTY, confirm: CONFIRM_SCHEMA_PROPERTY },
      required: ["invoice_id"],
      additionalProperties: false,
    },
  },
  {
    name: "issue_invoice",
    title: "Issue a draft invoice",
    description:
      "Issues a DRAFT invoice: it takes the next number of the QuickBooks sequence, goes into the accounts, and its orders move to 'Invoiced / Paid'. After that it can't be changed or deleted, only voided. It is NOT emailed: sending to the dealer stays a manual step in the app." +
      WRITE_NOTE,
    inputSchema: {
      type: "object",
      properties: { invoice_id: INVOICE_ID_PROPERTY, confirm: CONFIRM_SCHEMA_PROPERTY },
      required: ["invoice_id"],
      additionalProperties: false,
    },
  },
  {
    name: "void_invoice",
    title: "Void an issued invoice",
    description:
      "Voids an ISSUED invoice that has no payments, like 'Void' in QuickBooks: it keeps its number but stops counting, and its orders go back to 'To invoice' so the right one can be made. Ask the person why; the reason is recorded on the invoice and its orders. With payments recorded it is refused (a manager removes them in Odoo first)." +
      WRITE_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: INVOICE_ID_PROPERTY,
        reason: { type: "string", description: "Why it is voided, in the person's words (e.g. 'wrong price'). Required." },
        confirm: CONFIRM_SCHEMA_PROPERTY,
      },
      required: ["invoice_id", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "record_payment",
    title: "Record a payment on an invoice",
    description:
      "Records money received on an ISSUED invoice — the whole balance or part of it, never more. The orders' payment state follows (partial / paid). A payment can't be removed from the app or from here afterwards (only in Odoo), so check the amount, the date and the method with the person." +
      WRITE_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: INVOICE_ID_PROPERTY,
        amount: { type: "number", description: "Amount received, in USD. At most the balance due." },
        method: {
          type: "string",
          enum: ["check", "transfer", "zelle", "card", "cash", "other"],
          description: "How it was paid.",
        },
        date: { type: "string", description: "Date the money was received, YYYY-MM-DD. Defaults to today (Miami)." },
        reference: { type: "string", description: "Check number, transfer or Zelle reference, if any." },
        confirm: CONFIRM_SCHEMA_PROPERTY,
      },
      required: ["invoice_id", "amount", "method"],
      additionalProperties: false,
    },
  },
  {
    name: "invoice_pdf_link",
    title: "Download link for an invoice PDF",
    description:
      "Gives a link to download ONE invoice's PDF (a draft too: it prints as DRAFT INVOICE). Hand the link to the person exactly as returned: they open it in their browser and the PDF downloads. It works for 30 minutes and only for that invoice. Office/manager only.",
    inputSchema: {
      type: "object",
      properties: { invoice_id: INVOICE_ID_PROPERTY },
      required: ["invoice_id"],
      additionalProperties: false,
    },
  },
  {
    name: "send_invoice",
    title: "Email an invoice to the dealer",
    description:
      "Emails ONE issued invoice: the PDF, with its installation photos, goes attached. Without 'emails' it goes to the dealer's invoice addresses; 'message' replaces the standard text. This reaches the dealer and can't be taken back, so the person must check the recipients in the preview before confirming. A draft is never sent — issue it first with issue_invoice: what reaches a dealer always has a number." +
      WRITE_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: INVOICE_ID_PROPERTY,
        emails: {
          type: "array",
          items: { type: "string" },
          description: "Recipients, one address per item. Leave it out to use the dealer's invoice addresses (get_invoice shows them as dealer_emails).",
        },
        message: {
          type: "string",
          description: "Optional plain-text message instead of the standard one ('Please find attached invoice N for $X...'). Only when the person asked for one.",
        },
        confirm: CONFIRM_SCHEMA_PROPERTY,
      },
      required: ["invoice_id"],
      additionalProperties: false,
    },
  },
];

export const INVOICE_TOOL_NAMES = new Set(INVOICE_TOOL_DEFS.map((d) => d.name));

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

async function ordersToInvoice(id: McpIdentity) {
  await requireOfficeRole(id, "ver la facturación");
  const status = await billing<BillingStatus>(id, "indigo_billing_status");
  const groups = await billing<
    Array<{
      dealer: [number, string] | false;
      total: number;
      orders: Array<{
        id: number;
        name: string;
        client_name: string;
        dealer_ref: string | false;
        customer_po: string | false;
        door_count: number;
        total: number;
        installed_on: string | false;
        zip_missing: boolean;
      }>;
    }>
  >(id, "indigo_billing_to_invoice");
  return {
    ready: status.ready,
    ...(status.ready
      ? {}
      : { note: "La facturación desde la app no está activada: estas órdenes todavía se facturan en QuickBooks." }),
    dealers: groups.map((g) => ({
      dealer_id: Array.isArray(g.dealer) ? g.dealer[0] : null,
      dealer: Array.isArray(g.dealer) ? g.dealer[1] : null,
      total: g.total,
      orders: g.orders.map((o) => ({
        id: o.id,
        order: o.name,
        client: o.client_name,
        dealer_ref: o.dealer_ref || null,
        customer_po: o.customer_po || null,
        doors: o.door_count,
        total: o.total,
        installed_on: o.installed_on || null,
        zip_missing: o.zip_missing,
      })),
    })),
  };
}

function clamp(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(Math.floor(raw), max);
}

async function findInvoices(args: Record<string, unknown>, id: McpIdentity) {
  const status = optionalEnum(args, "status", ["draft", "open", "overdue", "paid", "all"] as const, "all");
  const filters: Record<string, unknown> = { status };
  if (args.dealer_id !== undefined) {
    if (typeof args.dealer_id !== "number" || !Number.isInteger(args.dealer_id)) invalid("'dealer_id' tiene que ser el id numérico de un dealer.");
    filters.dealer_id = args.dealer_id;
  }
  const from = optionalDate(args, "date_from");
  const to = optionalDate(args, "date_to");
  if (from) filters.date_from = from;
  if (to) filters.date_to = to;
  if (typeof args.search === "string" && args.search.trim()) filters.q = args.search.trim();
  const limit = clamp(args.limit, 25, 100);
  const offset = typeof args.offset === "number" && args.offset > 0 ? Math.floor(args.offset) : 0;

  await requireOfficeRole(id, "ver las facturas");
  const res = await billing<{ rows: InvoiceRow[]; summary: InvoiceSummary }>(id, "indigo_billing_list", [filters]);
  const page = res.rows.slice(offset, offset + limit);
  return {
    total: res.rows.length,
    truncated: offset + page.length < res.rows.length,
    invoices: page.map(formatRow),
    summary_of_issued: {
      invoices: res.summary.count,
      drafts: res.summary.drafts,
      invoiced: res.summary.total,
      sales_tax: res.summary.tax,
      collected: res.summary.collected,
      open: res.summary.open,
    },
  };
}

async function getInvoice(args: Record<string, unknown>, id: McpIdentity) {
  const moveId = requireId(args, "invoice_id", "get_invoice");
  await requireOfficeRole(id, "ver las facturas");
  const inv = await billing<InvoiceDetail>(id, "indigo_billing_detail", [moveId]);
  return {
    ...formatRow(inv),
    lines: inv.lines.map((l) => ({
      product_code: l.product_code,
      product: l.product_label,
      description: l.description,
      qty: l.qty,
      price_unit: l.price_unit,
      amount: l.subtotal,
      taxable: l.taxable,
      order_id: l.order_id || null,
    })),
    orders: inv.orders.map((o) => ({ id: o.id, order: o.name, client: o.client_name })),
    payments: inv.payments,
    photos: inv.photo_ids.length,
    sent_to: inv.sent_to || null,
    dealer_emails: inv.dealer_emails,
  };
}

// ---------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------

async function detailFor(id: McpIdentity, moveId: number): Promise<InvoiceDetail> {
  return billing<InvoiceDetail>(id, "indigo_billing_detail", [moveId]);
}

function notDraft(inv: InvoiceDetail, what: string): never {
  if (inv.state === "cancel") {
    throw mcpError("RECHAZADO", `La factura #${inv.name} está anulada: ya no se puede ${what}.`);
  }
  throw mcpError(
    "RECHAZADO",
    `La factura #${inv.name} ya está emitida: no se puede ${what}. Si está mal, anúlala con void_invoice y haz la correcta.`,
  );
}

async function planCreateInvoice(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const orderIds = requireOrderIds(args, "create_invoice");
  const photos = optionalEnum(args, "photos", ["installation", "none"] as const, "installation");
  const invoiceDate = optionalDate(args, "invoice_date");

  await requireOfficeRole(id, "facturar");
  const prev = await billing<InvoicePreview>(id, "indigo_billing_preview", [orderIds]);
  if (!prev.ready) throw notReady();

  // One live invoice per order: say which order and stop here, rather than
  // preview something the confirm would be refused for.
  const busy = prev.warnings.map((w) => /^(.+?) is already on invoice (.*)\.$/.exec(w)).filter(Boolean) as RegExpExecArray[];
  if (busy.length) {
    throw mcpError(
      "RECHAZADO",
      `${busy.map((m) => m[1]).join(", ")} ya ${busy.length === 1 ? "está" : "están"} en otra factura (borrador o emitida). Una orden va en una sola factura: borra ese borrador (delete_invoice) o anula esa factura (void_invoice) antes de volver a facturarla.`,
    );
  }

  const names: Record<number, string> = {};
  for (const l of prev.lines) if (l.order_id) names[l.order_id] = l.order_name ?? `orden ${l.order_id}`;
  const lines =
    args.lines === undefined
      ? prev.lines.map((l) => ({ ...l, order_name: undefined }))
      : parseInvoiceLines(args.lines, prev.order_ids, prev.dealer.tax_exempt);
  const photoIds = photos === "none" ? [] : prev.photos.filter((p) => p.default).map((p) => p.id);
  const totals = draftTotals(lines, prev.tax_rate);
  const avisos = warningsInSpanish(prev.warnings);

  const extra: Record<string, unknown> = {
    dealer: prev.dealer.name,
    orders: prev.order_ids.map((o) => names[o] ?? o),
    total: totals.total,
    lines: lines.map(toServiceLine),
  };
  return {
    message:
      `crear un BORRADOR de factura para ${prev.dealer.name}${prev.dealer.tax_exempt ? " (dealer exento de impuesto)" : ""}, ` +
      `con ${prev.order_ids.length === 1 ? "la orden" : "las órdenes"} ${Object.values(names).join(", ")}:\n` +
      describeLines(lines, prev.tax_rate, names) +
      `\n  Fotos: ${photoIds.length ? `${photoIds.length} de la instalación, en miniatura debajo de los totales` : "ninguna"}` +
      `\n  Fecha de la factura: ${invoiceDate ?? "hoy"}` +
      (avisos.length ? `\n  Avisos:\n${avisos.map((a) => `   - ${a}`).join("\n")}` : "") +
      `\nQueda como borrador, sin número y sin enviar: se puede cambiar con update_invoice o borrar con delete_invoice, y se numera al emitirla con issue_invoice.`,
    extra,
    execute: async () => {
      const moveId = await billing<number>(id, "indigo_billing_create_draft", [
        {
          dealer_id: prev.dealer.id,
          order_ids: prev.order_ids,
          lines: lines.map(toServiceLine),
          photo_ids: photoIds,
          ...(invoiceDate ? { invoice_date: invoiceDate } : {}),
        },
      ]);
      extra.invoice_id = moveId;
    },
  };
}

async function planUpdateInvoice(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const moveId = requireId(args, "invoice_id", "update_invoice");
  const photos = optionalEnum(args, "photos", ["keep", "installation", "none"] as const, "keep");
  const invoiceDate = optionalDate(args, "invoice_date");
  if (args.lines === undefined && photos === "keep" && !invoiceDate) {
    invalid("update_invoice no tiene nada que cambiar: pasa 'lines', 'photos' o 'invoice_date'.");
  }

  await requireOfficeRole(id, "cambiar facturas");
  const inv = await detailFor(id, moveId);
  if (inv.state !== "draft") notDraft(inv, "cambiar");

  const orderIds = inv.orders.map((o) => o.id);
  const names: Record<number, string> = Object.fromEntries(inv.orders.map((o) => [o.id, o.name]));
  const status = await billing<BillingStatus>(id, "indigo_billing_status");
  // The dealer's exemption and the installation photos come from the same
  // preview the app uses. It also warns that the orders are "already on"
  // this very draft — expected here, so its warnings are not repeated.
  const prev =
    orderIds.length && (args.lines !== undefined || photos === "installation")
      ? await billing<InvoicePreview>(id, "indigo_billing_preview", [orderIds])
      : null;

  const vals: Record<string, unknown> = {};
  const parts: string[] = [];
  const current = detailLines(inv);
  if (args.lines !== undefined) {
    const lines = parseInvoiceLines(args.lines, orderIds, prev?.dealer.tax_exempt ?? false);
    vals.lines = lines.map(toServiceLine);
    const after = draftTotals(lines, status.tax_rate);
    parts.push(
      `  Líneas nuevas (sustituyen a las ${current.length} de ahora):\n${describeLines(lines, status.tax_rate, names)}` +
        `\n  Total: ${usd(inv.total)} → ${usd(after.total)}`,
    );
  }
  if (photos !== "keep") {
    const ids = photos === "none" ? [] : (prev?.photos ?? []).filter((p) => p.default).map((p) => p.id);
    vals.photo_ids = ids;
    parts.push(`  Fotos: ${inv.photo_ids.length} → ${ids.length}`);
  }
  if (invoiceDate) {
    vals.invoice_date = invoiceDate;
    parts.push(`  Fecha: ${inv.invoice_date || "sin fecha"} → ${invoiceDate}`);
  }

  return {
    message:
      `cambiar ${invoiceLabel(inv)} (${ordersLabel(inv.orders)}):\n${parts.join("\n")}` +
      `\nSigue siendo borrador: sin número y sin enviar.`,
    extra: { invoice_id: inv.id, dealer: Array.isArray(inv.dealer) ? inv.dealer[1] : null },
    execute: async () => {
      await billing(id, "indigo_billing_update_draft", [moveId, vals]);
    },
  };
}

async function planDeleteInvoice(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const moveId = requireId(args, "invoice_id", "delete_invoice");
  await requireOfficeRole(id, "borrar facturas");
  const inv = await detailFor(id, moveId);
  if (inv.state !== "draft") notDraft(inv, "borrar");
  return {
    message:
      `borrar ${invoiceLabel(inv)} por ${usd(inv.total)} (${ordersLabel(inv.orders)}). ` +
      `Sus órdenes vuelven a la lista de «por facturar». Nunca se emitió, así que no tiene número ni deja hueco en la numeración.`,
    extra: { invoice_id: inv.id },
    execute: async () => {
      await billing(id, "indigo_billing_delete_draft", [moveId]);
    },
  };
}

async function planIssueInvoice(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const moveId = requireId(args, "invoice_id", "issue_invoice");
  await requireOfficeRole(id, "emitir facturas");
  const inv = await detailFor(id, moveId);
  if (inv.state !== "draft") notDraft(inv, "emitir otra vez");
  if (!inv.lines.length) throw mcpError("RECHAZADO", "El borrador no tiene líneas: añádelas con update_invoice antes de emitirlo.");
  const status = await billing<BillingStatus>(id, "indigo_billing_status");
  if (!status.ready) throw notReady();

  const extra: Record<string, unknown> = { invoice_id: inv.id };
  const head = `EMITIR ${invoiceLabel(inv)}: subtotal ${usd(inv.untaxed)}, impuesto ${usd(inv.tax)}, total ${usd(inv.total)}, con ${ordersLabel(inv.orders)}.`;
  const tail =
    ` Sus órdenes pasan a «Invoiced / Paid». Después ya no se puede cambiar ni borrar, solo anular.` +
    ` NO se envía al dealer: el envío se hace aparte, desde la app.`;
  const plan: WritePlan = {
    message: `${head} Toma el siguiente número de la numeración de QuickBooks (el ${status.next_number}, salvo que ya esté usado).${tail}`,
    extra,
    execute: async () => {
      const res = await billing<InvoiceDetail>(id, "indigo_billing_post", [moveId]);
      extra.number = res.name;
      // The number is only certain once Odoo gave it: say that one, not
      // the one the preview expected.
      plan.message = `${head} Quedó con el número ${res.name}.${tail}`;
    },
  };
  return plan;
}

async function planVoidInvoice(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const moveId = requireId(args, "invoice_id", "void_invoice");
  const reason = typeof args.reason === "string" ? args.reason.trim().slice(0, 500) : "";
  if (!reason) invalid("void_invoice requiere 'reason': pregúntale a la persona por qué se anula.");

  await requireOfficeRole(id, "anular facturas");
  const inv = await detailFor(id, moveId);
  if (inv.state === "draft") {
    throw mcpError("RECHAZADO", "Es un borrador, no una factura emitida: no se anula, se borra con delete_invoice.");
  }
  if (inv.state === "cancel") throw mcpError("RECHAZADO", `La factura #${inv.name} ya está anulada.`);
  if (inv.payments.length) {
    const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
    throw mcpError(
      "RECHAZADO",
      `La factura #${inv.name} tiene ${usd(paid)} en pagos registrados y no se puede anular desde aquí. Un gerente tiene que quitar esos pagos en Odoo primero.`,
    );
  }
  return {
    message:
      `ANULAR la factura #${inv.name} de ${Array.isArray(inv.dealer) ? inv.dealer[1] : "sin dealer"} por ${usd(inv.total)}. ` +
      `Conserva su número pero deja de contar, y ${ordersLabel(inv.orders)} vuelve${inv.orders.length === 1 ? "" : "n"} a «por facturar» para hacer la correcta. ` +
      `Motivo: "${reason}". No se puede deshacer.`,
    extra: { invoice_id: inv.id, number: inv.name },
    execute: async () => {
      await billing(id, "indigo_billing_void", [moveId, reason]);
    },
  };
}

const METHOD_LABEL: Record<string, string> = {
  check: "cheque",
  transfer: "transferencia",
  zelle: "Zelle",
  card: "tarjeta",
  cash: "efectivo",
  other: "otro",
};

async function planRecordPayment(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const moveId = requireId(args, "invoice_id", "record_payment");
  const raw = args.amount;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) invalid("record_payment requiere 'amount' mayor que 0.");
  const amount = Math.round(raw * 100) / 100;
  if (args.method === undefined) invalid("record_payment requiere 'method': cómo se pagó (check, transfer, zelle, card, cash, other).");
  const method = optionalEnum(args, "method", ["check", "transfer", "zelle", "card", "cash", "other"] as const, "other");
  const date = optionalDate(args, "date") ?? shopDateString(new Date());
  const reference = typeof args.reference === "string" ? args.reference.trim().slice(0, 120) : "";

  await requireOfficeRole(id, "registrar pagos");
  const inv = await detailFor(id, moveId);
  if (inv.state !== "posted") {
    throw mcpError(
      "RECHAZADO",
      inv.state === "draft"
        ? "Es un borrador: primero hay que emitirlo (issue_invoice) y después se registra el pago."
        : `La factura #${inv.name} está anulada: no admite pagos.`,
    );
  }
  if (inv.residual <= 0.005) throw mcpError("RECHAZADO", `La factura #${inv.name} ya está pagada entera.`);
  if (amount - inv.residual > 0.005) {
    invalid(`El pago (${usd(amount)}) es mayor que lo que falta por cobrar de la factura #${inv.name} (${usd(inv.residual)}).`);
  }
  const left = Math.round((inv.residual - amount) * 100) / 100;
  return {
    message:
      `registrar un pago de ${usd(amount)} (${METHOD_LABEL[method]}${reference ? ` · ${reference}` : ""}) con fecha ${date} ` +
      `en la factura #${inv.name} de ${Array.isArray(inv.dealer) ? inv.dealer[1] : "sin dealer"}. ` +
      `Saldo: ${usd(inv.residual)} → ${left <= 0.005 ? "$0.00, queda PAGADA" : usd(left)}. ` +
      `Un pago no se puede quitar ni desde la app ni desde aquí (solo en Odoo): comprueba importe, fecha y forma de pago.`,
    extra: { invoice_id: inv.id, number: inv.name, balance_after: Math.max(left, 0) },
    execute: async () => {
      await billing(id, "indigo_billing_register_payment", [moveId, { amount, date, method, reference }]);
    },
  };
}

async function invoicePdfLink(args: Record<string, unknown>, id: McpIdentity, now: number) {
  const moveId = requireId(args, "invoice_id", "invoice_pdf_link");
  await requireOfficeRole(id, "descargar facturas");
  const inv = await detailFor(id, moveId);
  const origin = (id.origin || process.env.PUBLIC_PANEL_URL || "https://app.indigodecors.com").replace(/\/+$/, "");
  const token = issuePdfLink({ uid: id.uid, apiKey: id.apiKey, invoiceId: moveId }, now);
  return {
    invoice_id: inv.id,
    number: inv.state !== "draft" ? inv.name || null : null,
    status: statusWord(inv.status),
    dealer: Array.isArray(inv.dealer) ? inv.dealer[1] : null,
    download_url: `${origin}/api/invoicing/pdf-link?t=${encodeURIComponent(token)}`,
    expires_in_minutes: PDF_LINK_TTL_SECONDS / 60,
  };
}

async function planSendInvoice(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const moveId = requireId(args, "invoice_id", "send_invoice");
  const emails = args.emails === undefined ? undefined : requireEmails(args.emails);
  if (args.message !== undefined && typeof args.message !== "string") invalid("'message' tiene que ser texto.");
  const message = typeof args.message === "string" ? args.message.trim().slice(0, 2000) : "";

  await requireOfficeRole(id, "enviar facturas");
  const inv = await detailFor(id, moveId);
  const dealer = Array.isArray(inv.dealer) ? inv.dealer[1] : "sin dealer";
  if (inv.state === "draft") {
    throw mcpError(
      "RECHAZADO",
      "Es un borrador y un borrador no se envía: lo que le llega al dealer siempre lleva número. Emítelo primero con issue_invoice y después envíalo.",
    );
  }
  if (inv.state === "cancel") throw mcpError("RECHAZADO", `La factura #${inv.name} está anulada: no se envía.`);
  const to = emails ?? inv.dealer_emails;
  if (!to.length) {
    throw mcpError(
      "RECHAZADO",
      `${dealer} no tiene correo de facturación guardado. Pregúntale a la persona a qué correo(s) enviarla y pásalos en 'emails'.`,
    );
  }
  const photos = inv.photo_ids.length;
  const extra: Record<string, unknown> = { invoice_id: inv.id, number: inv.name, sent_to: to };
  return {
    message:
      `ENVIAR por correo la factura #${inv.name} de ${dealer} (total ${usd(inv.total)}, saldo ${usd(inv.residual)}) a: ${to.join(", ")}. ` +
      `Va el PDF adjunto${photos ? ` con ${photos} foto${photos === 1 ? "" : "s"} de la instalación` : ""}. ` +
      (message ? `Mensaje: "${message}". ` : "Con el mensaje estándar («Please find attached invoice…»). ") +
      (inv.sent_at ? `Ya se envió antes (${inv.sent_to || "sin destinatarios guardados"}). ` : "") +
      `El correo le llega al dealer y no se puede deshacer: comprueba los destinatarios.`,
    extra,
    execute: async () => {
      await billing(id, "indigo_billing_send", [moveId, to, message || null]);
    },
  };
}

// ---------------------------------------------------------------------
// Dispatcher (called from tools.ts's dispatchTool)
// ---------------------------------------------------------------------

export async function runInvoiceTool(
  name: string,
  args: Record<string, unknown>,
  id: McpIdentity,
  now: number,
): Promise<unknown> {
  switch (name) {
    case "orders_to_invoice":
      return ordersToInvoice(id);
    case "find_invoices":
      return findInvoices(args, id);
    case "get_invoice":
      return getInvoice(args, id);
    case "create_invoice":
      return runWriteTool(name, args, id, () => planCreateInvoice(args, id), now);
    case "update_invoice":
      return runWriteTool(name, args, id, () => planUpdateInvoice(args, id), now);
    case "delete_invoice":
      return runWriteTool(name, args, id, () => planDeleteInvoice(args, id), now);
    case "issue_invoice":
      return runWriteTool(name, args, id, () => planIssueInvoice(args, id), now);
    case "void_invoice":
      return runWriteTool(name, args, id, () => planVoidInvoice(args, id), now);
    case "record_payment":
      return runWriteTool(name, args, id, () => planRecordPayment(args, id), now);
    case "invoice_pdf_link":
      return invoicePdfLink(args, id, now);
    case "send_invoice":
      return runWriteTool(name, args, id, () => planSendInvoice(args, id), now);
    default:
      throw mcpError("ENTRADA_INVALIDA", `Herramienta no reconocida: '${name}'.`);
  }
}
