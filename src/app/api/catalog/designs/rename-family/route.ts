import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { familyOf, planFamilyRename, renameInText } from "@/lib/catalog/family-rename";

export const runtime = "nodejs";

interface CodeRow {
  id: number;
  code: string;
  active?: boolean;
}

/**
 * POST /api/catalog/designs/rename-family — change a design's code.
 *
 * Body: { designId, nextFamily }
 *
 * What the operator sees as one design (`ID60`) is 1-3 `indigo.design`
 * records (`ID60-SD`, `ID60-DD`, `ID60-SDL`) plus a linked storefront
 * product per record, so a rename has to cascade. The family is derived
 * server-side from `designId` — never trusted from the client — so this can't
 * be pointed at codes the editor wasn't showing.
 *
 * Collisions are checked before ANY write: a half-applied rename splits the
 * family across two codes and it stops grouping in /catalog. If a write still
 * fails mid-way (a concurrent create taking the code), the codes already
 * changed are rolled back.
 */
export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as Partial<{ designId: number; nextFamily: string }>;
    const designId = Number(body.designId);
    if (!designId) {
      return NextResponse.json({ error: "designId is required." }, { status: 400 });
    }

    const anchor = await call<CodeRow[]>({
      session: s.session,
      model: "indigo.design",
      method: "read",
      args: [[designId], ["id", "code"]],
      kwargs: { context: { active_test: false } },
    });
    if (!anchor.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const family = familyOf(anchor[0].code.trim().toUpperCase());

    // Read every code in one go: it gives us both the family's siblings and
    // the collision set, and avoids `like`-escaping traps for codes that
    // contain `_` (a single-char wildcard in Odoo's like patterns).
    // Archived designs are included on purpose: they still hold their code
    // (the unique constraint applies to them too), so they can block a rename.
    const all = await call<CodeRow[]>({
      session: s.session,
      model: "indigo.design",
      method: "search_read",
      args: [[], ["id", "code", "active"]],
      kwargs: { limit: 5000, context: { active_test: false } },
    });

    const plan = planFamilyRename({
      family,
      nextFamily: body.nextFamily ?? "",
      siblings: all.filter((d) => familyOf(d.code.trim().toUpperCase()) === family),
      existingCodes: all.map((d) => d.code),
    });
    if (!plan.ok) {
      // A code held by an ARCHIVED design still blocks the rename but is
      // invisible in /catalog — say so, or the operator hunts for a design
      // that isn't on screen.
      const archived = (plan.conflicts ?? []).filter((c) =>
        all.some((d) => d.code.trim().toUpperCase() === c && d.active === false),
      );
      const error = archived.length
        ? `${plan.error} Ojo: ${archived.join(", ")} pertenece a un diseño archivado ` +
          `(no aparece en el catálogo, pero el código sigue ocupado).`
        : plan.error;
      return NextResponse.json(
        { error, conflicts: plan.conflicts },
        { status: plan.conflicts?.length ? 409 : 400 },
      );
    }
    if (plan.renames.length === 0) {
      return NextResponse.json({ ok: true, renamed: 0, family, nextFamily: plan.nextFamily });
    }

    // ---- Codes: the part that must not end up half-applied ----
    const done: typeof plan.renames = [];
    try {
      for (const r of plan.renames) {
        await call({
          session: s.session,
          model: "indigo.design",
          method: "write",
          args: [[r.id], { code: r.to }],
          kwargs: {},
        });
        done.push(r);
      }
    } catch (err) {
      // Each write is its own Odoo transaction, so undoing is a best effort.
      // Track what we could NOT put back: claiming "nothing changed" when a
      // record is still carrying the new code would send the operator looking
      // at a catalog that doesn't match what we told them.
      const stuck: string[] = [];
      for (const r of [...done].reverse()) {
        try {
          await call({
            session: s.session,
            model: "indigo.design",
            method: "write",
            args: [[r.id], { code: r.from }],
            kwargs: {},
          });
        } catch {
          stuck.push(`${r.from} → ${r.to}`);
        }
      }
      const msg = err instanceof Error ? err.message : "Error";
      if (stuck.length) {
        return NextResponse.json(
          {
            error:
              `El cambio de código falló a mitad y NO se pudo revertir del todo. ` +
              `Quedaron con el código nuevo: ${stuck.join(", ")}. ` +
              `Corregilos a mano antes de seguir usando el catálogo. (Causa: ${msg})`,
            stuck,
          },
          { status: 500 },
        );
      }
      return NextResponse.json(
        {
          error: /unique|duplicate|already exists/i.test(msg)
            ? "Otro diseño tomó ese código mientras guardábamos. No se cambió nada."
            : `No se pudo renombrar: ${msg}. No se cambió nada.`,
        },
        { status: 409 },
      );
    }

    const ids = plan.renames.map((r) => r.id);

    // ---- Display names: cosmetic, so failures here don't undo the rename ----
    // Design names carry the code ("ID60 Single Door"), as do the linked
    // storefront products created alongside them.
    try {
      const named = await call<Array<{ id: number; name: string | false }>>({
        session: s.session,
        model: "indigo.design",
        method: "read",
        args: [ids, ["id", "name"]],
        kwargs: { context: { active_test: false } },
      });
      for (const d of named) {
        const next = renameInText(d.name, family, plan.nextFamily);
        if (next !== d.name) {
          await call({
            session: s.session,
            model: "indigo.design",
            method: "write",
            args: [[d.id], { name: next }],
            kwargs: {},
          });
        }
      }
    } catch {
      // Leave the old display name; the code is what the catalog groups on.
    }

    let productsRenamed = 0;
    try {
      const prods = await call<Array<{ id: number; name: string | false }>>({
        session: s.session,
        model: "product.template",
        method: "search_read",
        args: [[["indigo_design_id", "in", ids]], ["id", "name"]],
        kwargs: { limit: 100 },
      });
      for (const p of prods) {
        const next = renameInText(p.name, family, plan.nextFamily);
        if (next !== p.name) {
          await call({
            session: s.session,
            model: "product.template",
            method: "write",
            args: [[p.id], { name: next }],
            kwargs: {},
          });
          productsRenamed += 1;
        }
      }
    } catch {
      // Storefront keeps the old product title; not worth failing the rename.
    }

    return NextResponse.json({
      ok: true,
      family,
      nextFamily: plan.nextFamily,
      renamed: plan.renames.length,
      productsRenamed,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
