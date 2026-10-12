import { test } from "node:test";
import assert from "node:assert/strict";
import { tabFromLocation } from "./settings-tabs.ts";

test("old section links and Intuit's return open the right tab", () => {
  assert.equal(tabFromLocation("#quickbooks", ""), "quickbooks");
  assert.equal(tabFromLocation("#invoicing", ""), "invoicing");
  assert.equal(tabFromLocation("#cost-rates", ""), "costs");
  assert.equal(tabFromLocation("#pay", ""), "pay");
  assert.equal(tabFromLocation("", "?qbo=connected"), "quickbooks");
  assert.equal(tabFromLocation("", ""), null);
  assert.equal(tabFromLocation("#constructor", ""), null);
});
