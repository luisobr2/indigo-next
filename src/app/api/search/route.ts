import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import type { SearchHits } from "@/lib/command-search";

export const runtime = "nodejs";

const LIMIT = 6;

type M2o = [number, string] | false;

/**
 * GET /api/search?q=  — what the Ctrl+K box finds: orders, invoices, dealers.
 *
 * Runs as the person (their Odoo session), so record rules decide what each
 * role sees. Invoices and dealers are only asked for office and managers; a
 * section that fails comes back empty instead of failing the whole search.
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    const empty: SearchHits = { orders: [], invoices: [], dealers: [] };
    if (q.length < 2) return NextResponse.json(empty);
    const office = role.isManager || role.isOffice || s.user.isAdmin;

    const orders = call<Array<{ id: number; name: string; client_name: string | false; dealer_id: M2o; stage_id: M2o; customer_po: string | false }>>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        ["|", "|", "|", "|",
          ["name", "ilike", q], ["client_name", "ilike", q], ["customer_po", "ilike", q],
          ["dealer_ref", "ilike", q], ["client_phone", "ilike", q]],
        ["id", "name", "client_name", "dealer_id", "stage_id", "customer_po"],
      ],
      kwargs: { limit: LIMIT, order: "create_date desc" },
    }).catch(() => []);

    const invoices = office
      ? call<Array<{ id: number; name: string; partner_id: M2o; amount_total: number; payment_state: string | false; state: string }>>({
          session: s.session,
          model: "account.move",
          method: "search_read",
          args: [
            [["move_type", "in", ["out_invoice", "out_refund"]], ["state", "!=", "cancel"],
              "|", "|", ["name", "ilike", q], ["partner_id.name", "ilike", q], ["indigo_order_ids.client_name", "ilike", q]],
            ["id", "name", "partner_id", "amount_total", "payment_state", "state"],
          ],
          kwargs: { limit: LIMIT, order: "id desc" },
        }).catch(() => [])
      : Promise.resolve([]);

    const dealers = office
      ? call<Array<{ id: number; name: string }>>({
          session: s.session,
          model: "res.partner",
          method: "search_read",
          args: [[["is_indigo_dealer", "=", true], ["name", "ilike", q]], ["id", "name"]],
          kwargs: { limit: 5, order: "name asc" },
        }).catch(() => [])
      : Promise.resolve([]);

    const [o, i, d] = await Promise.all([orders, invoices, dealers]);
    const hits: SearchHits = {
      orders: o.map((r) => ({
        id: r.id, name: r.name, client_name: r.client_name,
        dealer: r.dealer_id ? r.dealer_id[1] : false, stage: r.stage_id ? r.stage_id[1] : false,
        customer_po: r.customer_po,
      })),
      invoices: i.map((r) => ({
        id: r.id, name: r.name, partner: r.partner_id ? r.partner_id[1] : false,
        amount_total: r.amount_total, payment_state: r.payment_state, state: r.state,
      })),
      dealers: d,
    };
    return NextResponse.json(hits);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
