import { NextRequest, NextResponse } from "next/server";
import {
  requireSession,
  writeSession,
  pushOriginalSession,
  popOriginalSession,
  getOriginalSession,
} from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

const ODOO_URL = process.env.ODOO_URL ?? "http://localhost:8069";

/** Landing page for an impersonated user, based on their role. */
function landingFor(groups: string[]): string {
  const r = deriveRole(groups);
  if (r.isDesigner) return "/digitalization";
  if (r.isPainter) return "/paint";
  if (r.isCnc) return "/cnc-production";
  if (r.isInstaller) return "/installs";
  return "/dashboard";
}

/** Mint a session for `login` via the manager-gated Odoo controller (no
 *  password — the controller verifies the caller is a manager). */
async function impersonateViaOdoo(managerSession: string, login: string) {
  const res = await fetch(`${ODOO_URL}/indigo/impersonate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session_id=${managerSession}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { login } }),
  });
  const json = (await res.json()) as {
    result?: {
      session_id?: string;
      uid?: number;
      login?: string;
      name?: string;
      partner_id?: number;
      is_admin?: boolean;
      groups?: string[];
      error?: string;
    };
    error?: { data?: { message?: string } };
  };
  if (json.error) throw new Error(json.error.data?.message || "Impersonation failed");
  return json.result ?? {};
}

/**
 * POST /api/auth/impersonate
 *
 * Lets a Manager swap into another user's session. The current session
 * is stashed in a backup cookie so it can be restored later via the
 * DELETE endpoint on the same path.
 */
export async function POST(req: NextRequest) {
  try {
    const current = await requireSession();
    const role = deriveRole(current.user.groups);
    if (!role.isManager && !current.user.isAdmin) {
      return NextResponse.json(
        { error: "Only managers can impersonate" },
        { status: 403 },
      );
    }

    // Prevent nesting — if we're already impersonating, refuse.
    const already = await getOriginalSession();
    if (already) {
      return NextResponse.json(
        { error: "Already impersonating; exit first" },
        { status: 409 },
      );
    }

    const body = (await req.json()) as { login?: string };
    if (!body.login) {
      return NextResponse.json({ error: "login required" }, { status: 400 });
    }

    const r = await impersonateViaOdoo(current.session, body.login);
    if (r.error || !r.session_id) {
      return NextResponse.json(
        { error: r.error || "Impersonation failed" },
        { status: 400 },
      );
    }
    const user = {
      id: r.uid as number,
      login: r.login as string,
      name: r.name as string,
      partnerId: r.partner_id as number,
      isAdmin: !!r.is_admin,
      groups: r.groups ?? [],
    };
    await pushOriginalSession(current);
    await writeSession({ session: r.session_id, user });

    return NextResponse.json({ user, landing: landingFor(user.groups) });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Impersonate failed" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/auth/impersonate
 *
 * Exits impersonation and restores the manager's original session.
 */
export async function DELETE() {
  try {
    const original = await popOriginalSession();
    if (!original) {
      return NextResponse.json(
        { error: "Not impersonating" },
        { status: 404 },
      );
    }
    await writeSession(original);
    return NextResponse.json({ user: original.user });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Exit impersonation failed" },
      { status: 500 },
    );
  }
}
