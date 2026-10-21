import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { billingError } from "@/lib/billing/server";

export const runtime = "nodejs";

interface AnotaOdoo {
  enabled: boolean;
  project_key: string | false;
  url: string;
}

export interface AnotaConfig {
  enabled: boolean;
  projectKey: string | null;
  url: string;
  /** Who is signed in: the widget puts it on the note. */
  reporter: { name: string; email?: string };
  canManage: boolean;
}

/** Only an https origin may serve the widget script. */
function safeOrigin(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.origin : "https://anota.lbencomo94.workers.dev";
  } catch {
    return "https://anota.lbencomo94.workers.dev";
  }
}

/**
 * GET /api/anota — whether team notes (Anota) are on, for the signed-in
 * person. Staff only: a dealer always gets "off".
 * PUT /api/anota {enabled?, projectKey?} — office / managers.
 */
export async function GET() {
  try {
    const s = await requireSession();
    const r = deriveRole(s.user.groups);
    const staff = s.user.isAdmin || r.isManager || r.isOffice || r.isDesigner || r.isPainter || r.isCnc || r.isInstaller;
    const canManage = s.user.isAdmin || r.isManager || r.isOffice;
    const off: AnotaConfig = {
      enabled: false,
      projectKey: null,
      url: "https://anota.lbencomo94.workers.dev",
      reporter: { name: s.user.name },
      canManage,
    };
    if (!staff) return NextResponse.json({ data: off });
    const a = await call<AnotaOdoo>({
      session: s.session,
      model: "ir.config_parameter",
      method: "indigo_get_anota",
      args: [],
      kwargs: {},
    });
    const data: AnotaConfig = {
      enabled: !!a.enabled && !!a.project_key,
      projectKey: a.project_key || null,
      url: safeOrigin(a.url),
      reporter: { name: s.user.name, ...(s.user.login.includes("@") ? { email: s.user.login } : {}) },
      canManage,
    };
    return NextResponse.json({ data });
  } catch (e) {
    return billingError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const s = await requireSession();
    const r = deriveRole(s.user.groups);
    if (!s.user.isAdmin && !r.isManager && !r.isOffice) {
      return NextResponse.json({ error: "Only the office or a manager can change team notes." }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const vals: Record<string, unknown> = {};
    if (typeof body?.projectKey === "string") vals.project_key = body.projectKey.trim();
    if (typeof body?.enabled === "boolean") vals.enabled = body.enabled;
    if (!Object.keys(vals).length) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
    const a = await call<AnotaOdoo>({
      session: s.session,
      model: "ir.config_parameter",
      method: "indigo_set_anota",
      args: [vals],
      kwargs: {},
    });
    return NextResponse.json({ data: { enabled: !!a.enabled, projectKey: a.project_key || null, url: safeOrigin(a.url) } });
  } catch (e) {
    return billingError(e);
  }
}
