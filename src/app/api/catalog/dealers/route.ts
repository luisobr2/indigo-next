import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    // ?all=1 includes archived dealers (for the admin list); default returns
    // only active ones (used by the order forms).
    const all = new URL(req.url).searchParams.get("all") === "1";
    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "res.partner",
      method: "search_read",
      args: [
        [["is_indigo_dealer", "=", true]],
        ["id", "name", "email", "phone", "city", "indigo_default_price_per_sqf", "active"],
      ],
      kwargs: { order: "name asc", context: { active_test: !all } },
    });
    return NextResponse.json({ records });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as Partial<{
      name: string;
      email: string;
      phone: string;
      street: string;
      city: string;
      zip: string;
      indigo_default_price_per_sqf: number;
    }>;
    if (!body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const vals: Record<string, unknown> = {
      name: body.name,
      is_company: true,
      is_indigo_dealer: true,
      indigo_default_price_per_sqf: body.indigo_default_price_per_sqf ?? 0,
    };
    if (body.email) vals.email = body.email;
    if (body.phone) vals.phone = body.phone;
    if (body.street) vals.street = body.street;
    if (body.city) vals.city = body.city;
    if (body.zip) vals.zip = body.zip;

    const id = await call<number>({
      session: s.session,
      model: "res.partner",
      method: "create",
      args: [vals],
      kwargs: {},
    });
    return NextResponse.json({ id });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
