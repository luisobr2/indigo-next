import { NextResponse } from "next/server";
import { getSession, deriveRole } from "@/lib/odoo/session";

export const runtime = "nodejs";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({
    user: s.user,
    role: deriveRole(s.user.groups),
  });
}
