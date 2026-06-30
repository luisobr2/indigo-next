import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

/**
 * POST /api/orders/:id/note   body: { note?: string; incidence?: boolean }
 *
 * Adds a note to the order WITHOUT changing its stage — so an incident can be
 * logged without moving the order back a stage. Appends to the `notes` card
 * (dated, newest-first) and posts to the chatter/timeline. Optionally flags the
 * order as an open incidence (incidence=true) or clears it (incidence=false).
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: idStr } = await context.params;
    const orderId = Number(idStr);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }
    const body = (await req.json()) as { note?: string; incidence?: boolean };
    const noteText = (body.note ?? "").trim();
    const hasIncidenceChange = typeof body.incidence === "boolean";
    if (!noteText && !hasIncidenceChange) {
      return NextResponse.json({ error: "Write a note." }, { status: 400 });
    }
    const isIncidence = body.incidence === true;

    // Append to the prominent "Note" card (dated, newest first).
    if (noteText) {
      const cur = await call<Array<{ notes: string | false }>>({
        session: s.session,
        model: "indigo.order",
        method: "read",
        args: [[orderId], ["notes"]],
        kwargs: {},
      });
      const existing = (cur[0]?.notes || "") as string;
      const dateStr = new Date().toLocaleDateString("en-US");
      const tag = isIncidence ? " ⚠️ INCIDENCIA" : "";
      const line = `${dateStr}${tag}: ${noteText}`;
      await call({
        session: s.session,
        model: "indigo.order",
        method: "write",
        args: [[orderId], { notes: existing ? `${line}\n${existing}` : line }],
        kwargs: {},
      });

      // Chatter / timeline entry (plain text — Odoo renders it).
      await call({
        session: s.session,
        model: "indigo.order",
        method: "message_post",
        args: [[orderId]],
        kwargs: {
          body: `${isIncidence ? "⚠️ Incidencia: " : "Nota: "}${noteText}`,
          message_type: "comment",
        },
      }).catch(() => undefined);
    }

    // Set / clear the incidence flag. Separate + guarded so a DB that hasn't
    // got the column yet still saves the note.
    if (hasIncidenceChange) {
      await call({
        session: s.session,
        model: "indigo.order",
        method: "write",
        args: [[orderId], { incidence: isIncidence }],
        kwargs: {},
      }).catch(() => undefined);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
