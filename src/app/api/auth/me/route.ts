import { NextResponse } from "next/server";
import {
  getSession,
  getOriginalSession,
  deriveRole,
} from "@/lib/odoo/session";

export const runtime = "nodejs";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ user: null }, { status: 200 });

  // If a backup cookie is present, we're inside an impersonation session.
  // The frontend uses this to render a "Viewing as X" banner with an
  // Exit button.
  const original = await getOriginalSession();

  return NextResponse.json({
    user: s.user,
    role: deriveRole(s.user.groups),
    impersonating: original
      ? {
          original: {
            id: original.user.id,
            name: original.user.name,
            login: original.user.login,
          },
        }
      : null,
  });
}
