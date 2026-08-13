import { NextRequest, NextResponse } from "next/server";
import { call, OdooError } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { familyOf, planFamilyRename, renameInText } from "@/lib/catalog/family-rename";

export const runtime = "nodejs";

interface CodeRow {
  id: number;
  code: string;
  active?: boolean;
}

interface AtomicResult {
  family: string;
  next_family: string;
  renamed: Array<{ id: number; from: string; to: string }>;
  products_renamed: number;
}

/**
 * The addon method is missing — this Odoo predates `indigo.design.rename_family`.
 * Odoo answers a call to an undefined method with a plain AttributeError.
 */
function isMissingMethod(err: unknown): boolean {
  if (!(err instanceof OdooError)) return false;
  return (
    err.code === "builtins.AttributeError" ||
    /has no attribute|is not a valid|invalid method/i.test(err.message)
  );
}

/** Map an Odoo exception onto an HTTP answer the panel can show verbatim. */
function fromOdooError(err: unknown): NextResponse {
  if (err instanceof OdooError) {
    if (err.code === "odoo.exceptions.AccessError") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err.code === "odoo.exceptions.ValidationError") {
      // Every refusal this method raises is pre-flight and nothing was
      // written, so 409 is right for the dominant case (the code is taken).
      // The panel shows `error` regardless of the status.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Error" },
    { status: 500 },
  );
}

/**
 * POST /api/catalog/designs/rename-family — change a design's code.
 *
 * Body: { designId, nextFamily }
 *
 * What the operator sees as one design (`ID60`) is 1-3 `indigo.design`
 * records (`ID60-SD`, `ID60-DD`, `ID60-SDL`) plus a linked storefront
 * product per record, so a rename has to cascade.
 *
 * Preferred path is `indigo.design.rename_family`, which does the whole
 * cascade in ONE Odoo transaction — any error aborts everything. If the
 * deployed addon predates that method (the panel and the addon ship
 * separately), fall back to driving the cascade from here: same rules, but
 * one RPC per record, so it needs its own collision pre-check and rollback.
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
    const nextFamily = body.nextFamily ?? "";

    try {
      const res = await call<AtomicResult>({
        session: s.session,
        model: "indigo.design",
        method: "rename_family",
        args: [designId, nextFamily],
        kwargs: {},
      });
      return NextResponse.json({
        ok: true,
        atomic: true,
        family: res.family,
        nextFamily: res.next_family,
        renamed: res.renamed.length,
        productsRenamed: res.products_renamed,
      });
    } catch (err) {
      if (!isMissingMethod(err)) return fromOdooError(err);
      // Older addon: fall through to the panel-driven cascade below.
    }

    return await legacyCascade(s.session, designId, nextFamily);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

/**
 * Pre-addon fallback: same rules, driven with one RPC per record.
 *
 * Not atomic — each write is its own Odoo transaction — so it checks for
 * collisions before touching anything and rolls back what it managed to write
 * if a later write fails. Remove once every environment runs an addon with
 * `rename_family`.
 */
async function legacyCascade(
  session: string | null | undefined,
  designId: number,
  nextFamily: string,
): Promise<NextResponse> {
  const anchor = await call<CodeRow[]>({
    session,
    model: "indigo.design",
    method: "read",
    args: [[designId], ["id", "code"]],
    kwargs: { context: { active_test: false } },
  });
  if (!anchor.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const family = familyOf(anchor[0].code.trim().toUpperCase());

  // Archived designs are included on purpose: they still hold their code
  // (the unique constraint applies to them too), so they can block a rename.
  const all = await call<CodeRow[]>({
    session,
    model: "indigo.design",
    method: "search_read",
    args: [[], ["id", "code", "active"]],
    kwargs: { limit: 5000, context: { active_test: false } },
  });

  const plan = planFamilyRename({
    family,
    nextFamily,
    siblings: all.filter((d) => familyOf(d.code.trim().toUpperCase()) === family),
    existingCodes: all.map((d) => d.code),
  });
  if (!plan.ok) {
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
    return NextResponse.json({
      ok: true,
      atomic: false,
      renamed: 0,
      family,
      nextFamily: plan.nextFamily,
    });
  }

  // ---- Codes: the part that must not end up half-applied ----
  const done: typeof plan.renames = [];
  try {
    for (const r of plan.renames) {
      await call({
        session,
        model: "indigo.design",
        method: "write",
        args: [[r.id], { code: r.to }],
        kwargs: {},
      });
      done.push(r);
    }
  } catch (err) {
    // Undoing is a best effort. Track what we could NOT put back: claiming
    // "nothing changed" when a record still carries the new code would send
    // the operator looking at a catalog that doesn't match what we told them.
    const stuck: string[] = [];
    for (const r of [...done].reverse()) {
      try {
        await call({
          session,
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
  try {
    const named = await call<Array<{ id: number; name: string | false }>>({
      session,
      model: "indigo.design",
      method: "read",
      args: [ids, ["id", "name"]],
      kwargs: { context: { active_test: false } },
    });
    for (const d of named) {
      const next = renameInText(d.name, family, plan.nextFamily);
      if (next !== d.name) {
        await call({
          session,
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
      session,
      model: "product.template",
      method: "search_read",
      args: [[["indigo_design_id", "in", ids]], ["id", "name"]],
      kwargs: { limit: 100 },
    });
    for (const p of prods) {
      const next = renameInText(p.name, family, plan.nextFamily);
      if (next !== p.name) {
        await call({
          session,
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
    atomic: false,
    family,
    nextFamily: plan.nextFamily,
    renamed: plan.renames.length,
    productsRenamed,
  });
}
