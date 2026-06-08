import { NextResponse } from "next/server";
import { destroySession } from "@/lib/odoo/client";
import { clearSession, getSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

export async function POST() {
  const s = await getSession();
  if (s) await destroySession(s.session);
  await clearSession();
  return NextResponse.json({ ok: true });
}
