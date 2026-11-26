import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { orderNumberSuffix, phonePattern, type DoorLine, type SearchHits } from "@/lib/command-search";

export const runtime = "nodejs";

const LIMIT = 8;

type M2o = [number, string] | false;

type OrderRow = {
  id: number; name: string; client_name: string | false; dealer_id: M2o; stage_id: M2o; customer_po: string | false;
  client_phone: string | false; client_address: string | false; installation_date: string | false;
};
const ORDER_FIELDS = ["id", "name", "client_name", "dealer_id", "stage_id", "customer_po", "client_phone", "client_address", "installation_date"];

/**
 * GET /api/search?q=  — what the Ctrl+K box finds: orders, invoices, dealers
 * and catalog designs, with what its preview pane shows for each.
 *
 * Runs as the person (their Odoo session), so record rules decide what each
 * role sees. Invoices and dealers are only asked for office and managers; a
 * secondary section that fails comes back empty instead of failing the search.
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    const empty: SearchHits = { orders: [], invoices: [], dealers: [], designs: [] };
    if (q.length < 2) return NextResponse.json(empty);
    const office = role.isManager || role.isOffice || s.user.isAdmin;
    const rpc = <T,>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) =>
      call<T>({ session: s.session, model, method, args, kwargs });

    // ---- orders: a bare number first, then everything that matches ----
    const phone = phonePattern(q);
    const orderTerms: unknown[] = [
      ["name", "ilike", q], ["client_name", "ilike", q], ["customer_po", "ilike", q],
      ["dealer_ref", "ilike", q], ["client_address", "ilike", q],
      ["client_phone", "ilike", phone ?? q],
    ];
    const orderDomain = [...Array(orderTerms.length - 1).fill("|"), ...orderTerms];
    const suffix = orderNumberSuffix(q);
    const ordersP = Promise.all([
      suffix
        ? rpc<OrderRow[]>("indigo.order", "search_read", [[["name", "=ilike", `%${suffix}`]], ORDER_FIELDS], { limit: 3, order: "create_date desc" })
            .catch(() => [] as OrderRow[])
        : Promise.resolve([] as OrderRow[]),
      rpc<OrderRow[]>("indigo.order", "search_read", [orderDomain, ORDER_FIELDS], { limit: LIMIT, order: "create_date desc" }),
    ]).then(([first, rest]) => {
      const seen = new Set(first.map((r) => r.id));
      return [...first, ...rest.filter((r) => !seen.has(r.id))].slice(0, LIMIT);
    });

    const invoicesP = office
      ? rpc<Array<{ id: number; name: string; partner_id: M2o; amount_total: number; amount_residual: number; payment_state: string | false; state: string; invoice_date: string | false; indigo_order_ids: number[] }>>(
          "account.move", "search_read",
          [
            [["move_type", "in", ["out_invoice", "out_refund"]], ["state", "!=", "cancel"],
              "|", "|", "|", ["name", "ilike", q], ["partner_id.name", "ilike", q],
              ["indigo_order_ids.client_name", "ilike", q], ["indigo_order_ids.customer_po", "ilike", q]],
            ["id", "name", "partner_id", "amount_total", "amount_residual", "payment_state", "state", "invoice_date", "indigo_order_ids"],
          ],
          { limit: 6, order: "id desc" },
        ).catch(() => [])
      : Promise.resolve([]);

    const dealersP = office
      ? rpc<Array<{ id: number; name: string; phone: string | false; email: string | false; city: string | false }>>(
          "res.partner", "search_read",
          [[["is_indigo_dealer", "=", true], ["name", "ilike", q]], ["id", "name", "phone", "email", "city"]],
          { limit: 5, order: "name asc" },
        ).catch(() => [])
      : Promise.resolve([]);

    const designsP = rpc<Array<{ id: number; code: string; name: string | false; door_type: string | false }>>(
      "indigo.design", "search_read",
      [["|", ["code", "ilike", q], ["name", "ilike", q]], ["id", "code", "name", "door_type"]],
      { limit: 6, order: "code asc" },
    ).catch(() => []);

    const [orders, invoices, dealers, designs] = await Promise.all([ordersP, invoicesP, dealersP, designsP]);

    // Doors of the orders found, and the clients behind the invoices: one call each.
    const [lines, invoiceOrders] = await Promise.all([
      orders.length
        ? rpc<Array<{ order_id: M2o; design_id: M2o; door_type: string | false; color: string | false; qty: number }>>(
            "indigo.order.line", "search_read",
            [[["order_id", "in", orders.map((o) => o.id)]], ["order_id", "design_id", "door_type", "color", "qty"]],
            { order: "id asc" },
          ).catch(() => [])
        : Promise.resolve([]),
      invoices.length
        ? rpc<Array<{ id: number; client_name: string | false }>>(
            "indigo.order", "read",
            [[...new Set(invoices.flatMap((i) => i.indigo_order_ids))].slice(0, 60), ["client_name"]],
          ).catch(() => [])
        : Promise.resolve([]),
    ]);
    // Doors show the design CODE (ID01-DD), not its long name.
    const designIds = [...new Set(lines.map((l) => (l.design_id ? l.design_id[0] : 0)).filter(Boolean))];
    const codes = designIds.length
      ? await rpc<Array<{ id: number; code: string }>>("indigo.design", "read", [designIds, ["code"]]).catch(() => [])
      : [];
    const codeOf = new Map(codes.map((c) => [c.id, c.code]));
    const doorsByOrder = new Map<number, DoorLine[]>();
    for (const l of lines) {
      if (!l.order_id) continue;
      const list = doorsByOrder.get(l.order_id[0]) ?? [];
      list.push({
        design: l.design_id ? codeOf.get(l.design_id[0]) || l.design_id[1] : false,
        design_id: l.design_id ? l.design_id[0] : false,
        door_type: l.door_type,
        color: l.color,
        qty: l.qty || 1,
      });
      doorsByOrder.set(l.order_id[0], list);
    }
    const clientOf = new Map(invoiceOrders.map((o) => [o.id, o.client_name || ""]));

    const hits: SearchHits = {
      orders: orders.map((r) => ({
        id: r.id, name: r.name, client_name: r.client_name,
        dealer: r.dealer_id ? r.dealer_id[1] : false, stage: r.stage_id ? r.stage_id[1] : false,
        customer_po: r.customer_po, client_phone: r.client_phone, client_address: r.client_address,
        installation_date: r.installation_date, doors: doorsByOrder.get(r.id) ?? [],
      })),
      invoices: invoices.map((r) => ({
        id: r.id, name: r.name, partner: r.partner_id ? r.partner_id[1] : false,
        amount_total: r.amount_total, amount_residual: r.amount_residual, payment_state: r.payment_state,
        state: r.state, invoice_date: r.invoice_date,
        clients: [...new Set(r.indigo_order_ids.map((id) => clientOf.get(id)).filter(Boolean))].join(", "),
      })),
      dealers,
      designs,
    };
    return NextResponse.json(hits);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
