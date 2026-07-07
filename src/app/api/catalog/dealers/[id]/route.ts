import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/** Partner fields the dealer editor is allowed to write — prevents
 *  mass-assignment of arbitrary res.partner fields via the raw body. */
const EDITABLE_DEALER_FIELDS = [
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
  "indigo_charge_install_fee",
  "active",
] as const;

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
  "indigo_charge_install_fee",
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

    // Portal-access status — only for users who can manage it (managers/office).
    // Fetching it for others would trip the Odoo guard and 500 the whole page.
    const role = deriveRole(s.user.groups);
    let portal:
      | { has_user: boolean; login: string | false; active: boolean }
      | null = null;
    if (role.isManager || role.isOffice || s.user.isAdmin) {
      portal = await call<{
        has_user: boolean;
        login: string | false;
        active: boolean;
      }>({
        session: s.session,
        model: "res.partner",
        method: "indigo_dealer_portal_info",
        args: [id],
        kwargs: {},
      });
    }

    return NextResponse.json({ dealer: records[0], orders, portal });
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
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const raw = (await req.json()) as Record<string, unknown>;
    const vals: Record<string, unknown> = {};
    for (const k of EDITABLE_DEALER_FIELDS) {
      if (k in raw) vals[k] = raw[k];
    }
    if (Object.keys(vals).length === 0) {
      return NextResponse.json(
        { error: "No editable fields provided" },
        { status: 400 },
      );
    }
    if ("name" in vals && !String(vals.name ?? "").trim()) {
      return NextResponse.json({ error: "Dealer name can't be empty." }, { status: 400 });
    }
    if ("indigo_default_price_per_sqf" in vals) {
      const p = Number(vals.indigo_default_price_per_sqf);
      if (!Number.isFinite(p) || p < 0) {
        return NextResponse.json(
          { error: "Price per SQF must be 0 or greater." },
          { status: 400 },
        );
      }
    }
    await call<boolean>({
      session: s.session,
      model: "res.partner",
      method: "write",
      args: [[id], vals],
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
