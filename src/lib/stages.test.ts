import test from "node:test";
import assert from "node:assert/strict";
import { isPaintStage, PAINT_SHOP_OF_STAGE, PAINT_STAGE_OF_SHOP, PAINT_STAGES } from "./stages.ts";

test("both painting stages count as painting, nothing else does", () => {
  assert.equal(isPaintStage("painting"), true);
  assert.equal(isPaintStage("painting_indigo"), true);
  for (const code of ["cnc", "ready_install", "", null, undefined, false]) {
    assert.equal(isPaintStage(code as string), false);
  }
});

test("each painting stage belongs to one shop and back", () => {
  for (const stage of PAINT_STAGES) {
    assert.equal(PAINT_STAGE_OF_SHOP[PAINT_SHOP_OF_STAGE[stage]], stage);
  }
  assert.equal(PAINT_SHOP_OF_STAGE.painting, "michel");
  assert.equal(PAINT_SHOP_OF_STAGE.painting_indigo, "indigo");
});
