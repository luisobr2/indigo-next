import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

const DEALER_FIELDS = [
  "id",
  "name",
  "email",
  "phone",
  "street",
  "city",
  "zip",
  "state_id",
  "country_id",
  "is_indigo_dealer",
  "indigo_default_price_per_sqf",
  "active",
];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);

    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "res.partner",
      method: "read",
      args: [[id], DEALER_FIELDS],
      kwargs: {},
    });
    if (!records.length)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Active orders count + recent ones
    const orderIds = await call<number[]>({
      session: s.session,
      model: "indigo.order",
      method: "search",
      args: [
        [
          ["dealer_id", "=", id],
          ["stage_id.code", "not in", ["closed", "invoiced"]],
        ],
      ],
      kwargs: { limit: 10, order: "create_date desc" },
    });
    const orders = orderIds.length
      ? await call<Array<Record<string, unknown>>>({
          session: s.session,
          model: "indigo.order",
          method: "read",
          args: [
            orderIds,
            [
              "id",
              "name",
              "client_name",
              "stage_id",
              "total_dealer_charge",
              "create_date",
            ],
          ],
          kwargs: {},
        })
      : [];

    return NextResponse.json({ dealer: records[0], orders });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    const body = await req.json();
    await call<boolean>({
      session: s.session,
      model: "res.partner",
      method: "write",
      args: [[id], body],
      kwargs: {},
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
