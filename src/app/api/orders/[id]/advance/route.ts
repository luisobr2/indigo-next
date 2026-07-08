import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/** Wizards that move money — office/manager only. (Marking installed is handled
 *  separately below: installers may close their OWN assigned installs.) */
const SENSITIVE_WIZARDS = new Set([
  "indigo.invoiced.paid.wizard",
]);

/**
 * Only the known Indigo stage wizards may be driven from the panel.
 * Without this, `body.wizard` would let a caller `create` a record on any
 * Odoo model that happens to expose `action_save_and_advance`.
 */
const ALLOWED_WIZARDS = new Set([
  "indigo.measurement.entry.wizard",
  "indigo.sqf.entry.wizard",
  "indigo.cnc.done.wizard",
  "indigo.painter.done.wizard",
  "indigo.installed.wizard",
  "indigo.invoiced.paid.wizard",
]);

/**
 * Trigger an Odoo stage-advance wizard from the Next UI.
 *
 *   body = {
 *     wizard:  "indigo.painter.done.wizard",
 *     payload: {                                  // wizard field values
 *       note?:      "Optional chatter note",
 *       photo?:     "<base64 photo data, no prefix>",
 *       signature?: "<base64 PNG signature, no prefix>",
 *     }
 *   }
 *
 * Mirror of the buttons in the Odoo order form header: create the
 * wizard with the right payload, then `action_save_and_advance` does
 * the stage move + chatter post + attachments + payouts in one go.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const orderId = parseInt(idStr, 10);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }
    const body = await req.json();
    const wizardModel = body.wizard as string;
    const payload = (body.payload ?? {}) as Record<string, unknown>;

    if (!wizardModel) {
      return NextResponse.json(
        { error: "wizard model required" },
        { status: 400 },
      );
    }
    if (!ALLOWED_WIZARDS.has(wizardModel)) {
      return NextResponse.json(
        { error: "Unknown stage wizard" },
        { status: 400 },
      );
    }
    // Money wizards are office/manager only (Odoo ACLs alone don't stop an
    // internal contractor from invoicing here).
    if (SENSITIVE_WIZARDS.has(wizardModel)) {
      const role = deriveRole(s.user.groups);
      if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    // Marking an order installed is the installer's job from their portal.
    // Office/manager/admin can close any; an installer may close ONLY an
    // install assigned to them (installer_ids holds their partner).
    if (wizardModel === "indigo.installed.wizard") {
      const role = deriveRole(s.user.groups);
      const privileged = role.isManager || role.isOffice || s.user.isAdmin;
      if (!privileged) {
        if (!role.isInstaller) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const rows = await call<Array<{ installer_ids: number[] }>>({
          session: s.session,
          model: "indigo.order",
          method: "search_read",
          args: [[["id", "=", orderId]], ["installer_ids"]],
          kwargs: { limit: 1 },
        });
        const assigned = rows[0]?.installer_ids ?? [];
        if (!assigned.includes(s.user.partnerId)) {
          return NextResponse.json(
            { error: "This installation isn't assigned to you." },
            { status: 403 },
          );
        }
      }
    }
    // Guard the collected amount when present (invoice/paid wizard).
    if ("amount_collected" in payload) {
      const amt = Number(payload.amount_collected);
      if (!Number.isFinite(amt) || amt < 0) {
        return NextResponse.json(
          { error: "Invalid amount collected" },
          { status: 400 },
        );
      }
    }

    // Per-line SQF write (used by the digitization wizard). Apply to
    // indigo.order.line BEFORE creating the wizard so the wizard's
    // related fields (total_sqf etc.) reflect the new values.
    const lineSqfs = payload.line_sqfs as Record<string, number> | undefined;
    if (lineSqfs) {
      await Promise.all(
        Object.entries(lineSqfs).map(([lineIdStr, sqf]) => {
          const lineId = Number(lineIdStr);
          const n = Number(sqf);
          if (!Number.isFinite(lineId) || !Number.isFinite(n)) return null;
          return call({
            session: s.session,
            model: "indigo.order.line",
            method: "write",
            args: [[lineId], { sqf: n }],
            kwargs: {},
          });
        }),
      );
      delete payload.line_sqfs;
    }

    // Per-line width/height write (used by the measurement wizard). Apply to
    // indigo.order.line BEFORE creating the wizard so the dimensions are
    // persisted when the wizard advances to Measured.
    const lineDims = payload.line_dims as
      | Record<string, { width: number; height: number }>
      | undefined;
    if (lineDims) {
      await Promise.all(
        Object.entries(lineDims).map(([lineIdStr, dim]) => {
          const lineId = Number(lineIdStr);
          const w = Number(dim?.width);
          const h = Number(dim?.height);
          if (!Number.isFinite(lineId) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
          return call({
            session: s.session,
            model: "indigo.order.line",
            method: "write",
            args: [[lineId], { width: w, height: h }],
            kwargs: {},
          });
        }),
      );
      delete payload.line_dims;
    }

    const wizardId = await call<number>({
      session: s.session,
      model: wizardModel,
      method: "create",
      args: [{ order_id: orderId, ...payload }],
      kwargs: {},
    });

    await call({
      session: s.session,
      model: wizardModel,
      method: "action_save_and_advance",
      args: [[wizardId]],
      kwargs: {},
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error advancing stage";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
