import test from "node:test";
import assert from "node:assert/strict";
import { validateLineEdit, validateOrderEdit } from "./validation.ts";

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

test("SQF can be edited at any stage, but only as a real number", () => {
  assert.equal(validateLineEdit({ sqf: 18.5 }), null);
  assert.equal(validateLineEdit({ sqf: 0 }), null);
  assert.match(validateLineEdit({ sqf: -1 }) ?? "", /SQF/);
  assert.match(validateLineEdit({ sqf: "" }) ?? "", /SQF/);
  assert.match(validateLineEdit({ sqf: "abc" }) ?? "", /SQF/);
  assert.match(validateLineEdit({ sqf: 5000 }) ?? "", /SQF/);
});
