/**
 * Renaming a design code is a cascade, not a single write.
 *
 * A "design" the operator sees as `ID60` is really 1-3 Odoo records
 * (`ID60-SD`, `ID60-DD`, `ID60-SDL`), plus a linked storefront
 * `product.template` whose name carries the same prefix. Renaming has to
 * touch all of them or the catalog ends up half-renamed — a family split in
 * two that no longer groups in /catalog.
 *
 * This module is the pure part: work out the full set of writes and refuse
 * the whole thing up front if any target code is taken. The route does the
 * I/O; keeping the rules here means they can be tested without an Odoo.
 */

/** Matches a code that ends in a door-type suffix. */
const SUFFIX_RE = /^(.+)-(SD|DD|SDL)$/i;

/**
 * Codes end up on printed labels, QR payloads and attachment filenames, so
 * keep them to the characters that survive all three.
 */
const VALID_FAMILY_RE = /^[A-Z0-9][A-Z0-9_-]*$/;

/**
 * Compute the family code for a design code — same rule as
 * /api/catalog/designs/families, which is what actually groups the catalog
 * grid. Strip a trailing `-SD` / `-DD` / `-SDL` only when a real code is left
 * in front, so two unrelated short codes never collapse into one family.
 */
export function familyOf(code: string): string {
  const m = code.match(SUFFIX_RE);
  if (m && m[1].length >= 2) return m[1];
  return code;
}

export interface RenameItem {
  id: number;
  from: string;
  to: string;
}

export interface RenamePlanInput {
  /** Current family prefix, e.g. "ID60". */
  family: string;
  /** What the operator typed. Normalized here — may be lowercase or carry a suffix. */
  nextFamily: string;
  /** Every design record that might belong to the family. */
  siblings: Array<{ id: number; code: string }>;
  /** Codes already in the catalog, used to detect collisions. */
  existingCodes: string[];
}

export type RenamePlan =
  | { ok: true; nextFamily: string; renames: RenameItem[] }
  | { ok: false; error: string; conflicts?: string[] };

/**
 * Build the list of code writes for renaming a family, or explain why it
 * can't be done. An unchanged code is a no-op (`renames: []`), not an error.
 */
export function planFamilyRename(input: RenamePlanInput): RenamePlan {
  const nextFamily = familyOf(String(input.nextFamily ?? "").trim().toUpperCase());

  if (!nextFamily) {
    return { ok: false, error: "Poné un código." };
  }
  if (nextFamily.length < 2) {
    return { ok: false, error: "El código necesita al menos 2 caracteres." };
  }
  if (!VALID_FAMILY_RE.test(nextFamily)) {
    return {
      ok: false,
      error: "Usá solo letras, números, guion o guion bajo — sin espacios ni barras.",
    };
  }

  const family = String(input.family ?? "").trim().toUpperCase();
  if (nextFamily === family) {
    return { ok: true, nextFamily, renames: [] };
  }

  const renames: RenameItem[] = [];
  for (const s of input.siblings) {
    const code = s.code.trim().toUpperCase();
    const m = code.match(SUFFIX_RE);
    if (m && m[1].length >= 2) {
      // Only the versions of THIS family move; anything else stays put.
      if (m[1] !== family) continue;
      renames.push({ id: s.id, from: s.code, to: `${nextFamily}-${m[2].toUpperCase()}` });
    } else if (code === family) {
      // Standalone design with no door-type suffix.
      renames.push({ id: s.id, from: s.code, to: nextFamily });
    }
  }

  if (renames.length === 0) {
    return { ok: false, error: "No encontré versiones de este diseño para renombrar." };
  }

  // Refuse the whole rename if the target FAMILY is occupied — checking for a
  // duplicate code isn't enough. Renaming ID60 -> ARCH when a standalone
  // `ARCH` exists duplicates no code (targets are ARCH-SD/-DD), so the DB
  // constraint stays quiet, yet /designs/families groups them under the same
  // family and the two designs merge into one catalog card. Anything whose
  // family equals the target is a conflict.
  const own = new Set(renames.map((r) => r.from.trim().toUpperCase()));
  const conflicts = Array.from(
    new Set(
      input.existingCodes
        .map((c) => c.trim().toUpperCase())
        .filter((c) => !own.has(c) && familyOf(c) === nextFamily),
    ),
  );
  if (conflicts.length) {
    return {
      ok: false,
      error:
        `Ya hay un diseño usando ${nextFamily} (${conflicts.join(", ")}). ` +
        `Elegí otro código.`,
      conflicts,
    };
  }

  return { ok: true, nextFamily, renames };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Swap the family prefix inside a design/product name ("ID60 Single Door" →
 * "ID61 Single Door"). Only rewrites a prefix at the very start followed by a
 * boundary, so "Puerta tipo ID60" and "ID601 Single Door" are left alone.
 * Non-string values (Odoo returns `false` for empty) pass through untouched.
 */
export function renameInText<T>(text: T, family: string, nextFamily: string): T | string {
  if (typeof text !== "string" || !text) return text;
  const re = new RegExp(`^${escapeRegExp(family)}(?=$|[\\s-])`, "i");
  return text.replace(re, nextFamily);
}
