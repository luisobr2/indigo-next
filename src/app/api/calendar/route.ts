import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

const PENDING_INSTALL_CODES = ["ready_install", "install_scheduled"];

/**
 * GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Powers the Installations Calendar page:
 *   - events:  orders with an installation_date inside [from, to]
 *   - pending: orders ready/scheduled to install but with NO date yet,
 *              used by the "schedule on this day" picker.
 */
interface OrderRow {
  id: number;
  name: string;
  dealer_ref: string | false;
  dealer_id: [number, string] | false;
  client_name: string;
  client_address: string | false;
  installation_date: string | false;
  door_count: number;
  stage_code: string;
  installer_ids: number[];
}

export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const sp = req.nextUrl.searchParams;
    const from = (sp.get("from") || "").trim();
    const to = (sp.get("to") || "").trim();
    const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isYmd(from) || !isYmd(to)) {
      return NextResponse.json(
        { error: "from and to (YYYY-MM-DD) are required" },
        { status: 400 },
      );
    }

    const fields = [
      "id",
      "name",
      "dealer_ref",
      "dealer_id",
      "client_name",
      "client_address",
      "installation_date",
      "door_count",
      "stage_code",
      "installer_ids",
    ];

    const [events, pendingRaw] = await Promise.all([
      call<OrderRow[]>({
        session: s.session,
        model: "indigo.order",
        method: "search_read",
        args: [
          [
            ["installation_date", ">=", from],
            ["installation_date", "<=", to],
          ],
          fields,
        ],
        kwargs: { limit: 500, order: "installation_date" },
      }),
      call<OrderRow[]>({
        session: s.session,
        model: "indigo.order",
        method: "search_read",
        args: [
          [
            ["stage_id.code", "in", PENDING_INSTALL_CODES],
            ["installation_date", "=", false],
          ],
          fields,
        ],
        kwargs: { limit: 200, order: "create_date desc" },
      }),
    ]);

    const shape = (o: OrderRow) => ({
      id: o.id,
      name: o.name,
      dealer_ref: o.dealer_ref || "",
      dealer_id: o.dealer_id ? o.dealer_id[0] : 0,
      dealer_name: o.dealer_id ? o.dealer_id[1] : "",
      client_name: o.client_name,
      client_address: o.client_address || "",
      // Normalise to YYYY-MM-DD (Odoo Date comes back as a plain date string).
      date: o.installation_date ? String(o.installation_date).slice(0, 10) : "",
      door_count: o.door_count || 1,
      stage_code: o.stage_code,
      installer_ids: o.installer_ids || [],
    });

    return NextResponse.json({
      events: events.map(shape),
      pending: pendingRaw.map(shape),
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
