import { test } from "node:test";
import assert from "node:assert/strict";
import { imageFromFiles, latestImage, pastedImage, screenshotName } from "./clipboard-image.ts";

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
});

test("latestImage skips files that are not pictures", () => {
  const rows = [
    { id: 3, mimetype: "application/pdf" },
    { id: 2, mimetype: "image/png" },
    { id: 1, mimetype: "image/jpeg" },
  ];
  assert.equal(latestImage(rows)?.id, 2);
  assert.equal(latestImage([{ id: 1, mimetype: "text/plain" }]), null);
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
