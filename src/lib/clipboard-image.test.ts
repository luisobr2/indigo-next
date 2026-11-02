import { test } from "node:test";
import assert from "node:assert/strict";
import { cardImage, imageFromFiles, pastedImage, screenshotName } from "./clipboard-image.ts";

test("imageFromFiles picks the first image and ignores the rest", () => {
  const pdf = new File(["x"], "a.pdf", { type: "application/pdf" });
  const png = new File(["x"], "image.png", { type: "image/png" });
  assert.equal(imageFromFiles([pdf, png]), png);
  assert.equal(imageFromFiles([pdf]), null);
  assert.equal(imageFromFiles([]), null);
  assert.equal(imageFromFiles(null), null);
});

test("screenshotName stamps the time and keeps the format", () => {
  const at = new Date(2026, 9, 30, 9, 5, 7);
  assert.equal(screenshotName("image/png", at), "screenshot-20261030-090507.png");
  assert.equal(screenshotName("image/jpeg", at), "screenshot-20261030-090507.jpg");
  assert.equal(screenshotName("", at), "screenshot-20261030-090507.png");
  assert.equal(screenshotName("image/jpeg", at, "picture"), "picture-20261030-090507.jpg");
});

test("cardImage takes only pictures added from the image card", () => {
  const rows = [
    { id: 5, name: "contract.jpg", mimetype: "image/jpeg" },
    { id: 4, name: "screenshot-20261030-090507.pdf", mimetype: "application/pdf" },
    { id: 3, name: "picture-20261101-120000.jpg", mimetype: "image/jpeg" },
    { id: 2, name: "screenshot-20261030-090507.png", mimetype: "image/png" },
  ];
  // A contract photo from Files & Documents never covers the design.
  assert.equal(cardImage(rows)?.id, 3);
  assert.equal(cardImage(rows.slice(3))?.id, 2);
  assert.equal(cardImage([{ id: 1, name: "install.png", mimetype: "image/png" }]), null);
  assert.equal(cardImage([]), null);
});

test("pastedImage leaves text pastes and dialogs alone", () => {
  const png = new File(["x"], "image.png", { type: "image/png" });
  const free = { editable: false, inDialog: false };
  // A screenshot: only the image, taken even from a focused field.
  assert.equal(pastedImage([png], ["Files"], free), png);
  assert.equal(pastedImage([png], ["Files"], { editable: true, inDialog: false }), png);
  // Cells copied from Excel bring text and a picture of them: into a field, it's text.
  assert.equal(pastedImage([png], ["text/plain", "text/html", "Files"], { editable: true, inDialog: false }), null);
  assert.equal(pastedImage([png], ["text/plain", "Files"], free), png);
  // A paste inside another dialog belongs to that dialog.
  assert.equal(pastedImage([png], ["Files"], { editable: false, inDialog: true }), null);
  assert.equal(pastedImage([], ["text/plain"], free), null);
});
