import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/odoo/client";
import {
  requireSession,
  writeSession,
  pushOriginalSession,
  popOriginalSession,
  getOriginalSession,
} from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * Allowed impersonation targets and the password used to log in as them.
 *
 * For now the system seeds every test user with the same password
 * (`indigo123`) so the server keeps the list in code. When real per-user
 * passwords land, swap this for a server-side password vault or an
 * Odoo `_uid` swap mechanism.
 */
const IMPERSONATE_PASSWORD = process.env.IMPERSONATE_PASSWORD ?? "indigo123";

const ALLOWED_TARGETS: Array<{ login: string; landing: string }> = [
  { login: "majela@indigodecors.com", landing: "/dashboard" },
  { login: "oficina@indigodecors.com", landing: "/dashboard" },
  { login: "disenador@indigodecors.com", landing: "/digitalization" },
  { login: "pintor@indigodecors.com", landing: "/paint" },
  { login: "cnc@indigodecors.com", landing: "/cnc-production" },
  { login: "instalador@indigodecors.com", landing: "/installs" },
];

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
    const target = ALLOWED_TARGETS.find((t) => t.login === body.login);
    if (!target) {
      return NextResponse.json(
        { error: "Target not in allow-list" },
        { status: 400 },
      );
    }

    const auth = await authenticate(target.login, IMPERSONATE_PASSWORD);
    await pushOriginalSession(current);
    await writeSession({ session: auth.session, user: auth.user });

    return NextResponse.json({
      user: auth.user,
      landing: target.landing,
    });
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
