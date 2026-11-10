import test from "node:test";
import assert from "node:assert/strict";
import { messageText } from "./message-text.ts";

test("escaped tags from a panel note come out as plain text", () => {
  assert.equal(
    messageText("<p>Attachment uploaded: &lt;b&gt;Edvin Tomini Design Reference.jpg&lt;/b&gt;</p>"),
    "Attachment uploaded: Edvin Tomini Design Reference.jpg",
  );
});

test("a filename escaped twice keeps its ampersand", () => {
  assert.equal(messageText("<p>Attachment uploaded: &lt;b&gt;A &amp;amp; B.png&lt;/b&gt;</p>"), "Attachment uploaded: A & B.png");
});

test("real Odoo HTML keeps its line breaks", () => {
  assert.equal(messageText("<p>Stage changed</p><p>to <b>CNC</b></p>"), "Stage changed\nto CNC");
  assert.equal(messageText("line one<br>line two"), "line one\nline two");
});

test("a less-than sign typed in a note survives", () => {
  assert.equal(messageText("<p>width &lt; 30 and &gt; 20</p>"), "width < 30 and > 20");
});

test("empty bodies", () => {
  assert.equal(messageText(false), "");
  assert.equal(messageText(""), "");
});
