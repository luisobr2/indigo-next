import test from "node:test";
import assert from "node:assert/strict";
import { validateOrderEdit } from "./validation.ts";

test("an order without an email saves: Odoo hands the empty field back as false", () => {
  assert.equal(validateOrderEdit({ client_name: "Ana", client_email: false }), null);
  assert.equal(validateOrderEdit({ client_name: "Ana", client_email: null }), null);
  assert.equal(validateOrderEdit({ client_name: "Ana", client_email: "" }), null);
  assert.equal(validateOrderEdit({ client_name: "Ana", client_email: "   " }), null);
});

test("an email that is written still has to look like one", () => {
  assert.equal(validateOrderEdit({ client_email: "ana@example.com" }), null);
  assert.match(validateOrderEdit({ client_email: "ana@example" }) ?? "", /invalid/i);
});

test("the client name stays required, false included", () => {
  assert.match(validateOrderEdit({ client_name: "" }) ?? "", /empty/i);
  assert.match(validateOrderEdit({ client_name: false }) ?? "", /empty/i);
});
