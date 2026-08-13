import test from "node:test";
import assert from "node:assert/strict";

// Explicit .ts extension so `node --test` (which resolves as ESM) finds it.
import { familyOf, planFamilyRename, renameInText } from "./family-rename.ts";

const siblings = [
  { id: 11, code: "ID60-SD" },
  { id: 12, code: "ID60-DD" },
  { id: 13, code: "ID60-SDL" },
];

test("familyOf mirrors the grouping rule used by /designs/families", () => {
  assert.equal(familyOf("ID01-SD"), "ID01");
  assert.equal(familyOf("ID29-DD"), "ID29");
  assert.equal(familyOf("ID29-SDL"), "ID29");
  // Too short a prefix must not be collapsed, or unrelated codes would merge.
  assert.equal(familyOf("A-SD"), "A-SD");
  assert.equal(familyOf("TD-SD-W06"), "TD-SD-W06");
  assert.equal(familyOf("ARCH"), "ARCH");
});

test("renames every sibling, preserving each door-type suffix", () => {
  const plan = planFamilyRename({
    family: "ID60",
    nextFamily: "ID61",
    siblings,
    existingCodes: ["ID60-SD", "ID60-DD", "ID60-SDL", "ID07-SD"],
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok && plan.renames, [
    { id: 11, from: "ID60-SD", to: "ID61-SD" },
    { id: 12, from: "ID60-DD", to: "ID61-DD" },
    { id: 13, from: "ID60-SDL", to: "ID61-SDL" },
  ]);
});

test("normalizes the typed code: trims, uppercases, strips a typed suffix", () => {
  const plan = planFamilyRename({
    family: "ID60",
    nextFamily: "  id61-sd ",
    siblings,
    existingCodes: siblings.map((s) => s.code),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.ok && plan.nextFamily, "ID61");
  assert.deepEqual(
    plan.ok && plan.renames.map((r) => r.to),
    ["ID61-SD", "ID61-DD", "ID61-SDL"],
  );
});

test("an unchanged code is a no-op, not an error", () => {
  const plan = planFamilyRename({
    family: "ID60",
    nextFamily: "id60",
    siblings,
    existingCodes: siblings.map((s) => s.code),
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok && plan.renames, []);
});

test("rejects codes that would break family grouping or labels", () => {
  const bad = ["", "   ", "A", "ID 61", "ID/61", "-SD"];
  for (const nextFamily of bad) {
    const plan = planFamilyRename({
      family: "ID60",
      nextFamily,
      siblings,
      existingCodes: [],
    });
    assert.equal(plan.ok, false, `expected ${JSON.stringify(nextFamily)} to be rejected`);
  }
});

test("refuses the whole rename when any target code is taken", () => {
  const plan = planFamilyRename({
    family: "ID60",
    nextFamily: "ID61",
    siblings,
    // ID61-DD already exists on another family — renaming would collide.
    existingCodes: ["ID60-SD", "ID60-DD", "ID60-SDL", "ID61-DD"],
  });
  assert.equal(plan.ok, false);
  assert.deepEqual(!plan.ok && plan.conflicts, ["ID61-DD"]);
});

test("refuses a rename that would MERGE two designs into one family", () => {
  // ARCH is a standalone design. Renaming ID60 -> ARCH produces ARCH-SD/-DD,
  // which /designs/families groups under "ARCH" together with the existing
  // ARCH record — two unrelated designs silently collapsed into one card.
  // No code is literally duplicated, so the DB constraint won't catch it.
  const plan = planFamilyRename({
    family: "ID60",
    nextFamily: "ARCH",
    siblings,
    existingCodes: ["ID60-SD", "ID60-DD", "ID60-SDL", "ARCH"],
  });
  assert.equal(plan.ok, false);
  assert.deepEqual(!plan.ok && plan.conflicts, ["ARCH"]);
});

test("a code that merely starts with the target is not a merge", () => {
  // ID61-XYZ has no door-type suffix, so its family is the whole code —
  // it never groups with ID61-SD and must not block the rename.
  const plan = planFamilyRename({
    family: "ID60",
    nextFamily: "ID61",
    siblings,
    existingCodes: ["ID60-SD", "ID61-XYZ", "ID610-SD"],
  });
  assert.equal(plan.ok, true);
});

test("the family's own codes never count as a collision", () => {
  const plan = planFamilyRename({
    family: "ID60",
    nextFamily: "ID60X",
    siblings,
    existingCodes: ["ID60-SD", "ID60-DD", "ID60-SDL"],
  });
  assert.equal(plan.ok, true);
});

test("a standalone design (no door-type suffix) renames its bare code", () => {
  const plan = planFamilyRename({
    family: "ARCH",
    nextFamily: "ARCH2",
    siblings: [{ id: 40, code: "ARCH" }],
    existingCodes: ["ARCH"],
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok && plan.renames, [{ id: 40, from: "ARCH", to: "ARCH2" }]);
});

test("siblings outside the family are left alone", () => {
  const plan = planFamilyRename({
    family: "ID60",
    nextFamily: "ID61",
    siblings: [...siblings, { id: 99, code: "ID7-SD" }],
    existingCodes: [],
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.ok && plan.renames.map((r) => r.id),
    [11, 12, 13],
  );
});

test("renameInText swaps the family prefix in design/product names only at the start", () => {
  assert.equal(renameInText("ID60 Single Door", "ID60", "ID61"), "ID61 Single Door");
  assert.equal(renameInText("ID60-SD", "ID60", "ID61"), "ID61-SD");
  // Must not rewrite an unrelated name that merely contains the code.
  assert.equal(renameInText("Puerta tipo ID60", "ID60", "ID61"), "Puerta tipo ID60");
  // A longer code that only starts with the family is not a match either.
  assert.equal(renameInText("ID601 Single Door", "ID60", "ID61"), "ID601 Single Door");
  assert.equal(renameInText(false, "ID60", "ID61"), false);
});
