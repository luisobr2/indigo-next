import { NextRequest, NextResponse } from "next/server";
import { authenticate, OdooError } from "@/lib/odoo/client";
import { writeSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { login?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { login, password } = body;
  if (!login || !password) {
    return NextResponse.json(
      { error: "login and password required" },
      { status: 400 },
    );
  }

  try {
    const auth = await authenticate(login, password);
    await writeSession({ session: auth.session, user: auth.user });
    return NextResponse.json({ user: auth.user });
  } catch (e) {
    const msg =
      e instanceof OdooError ? e.message : "Login failed (check server logs)";
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}
