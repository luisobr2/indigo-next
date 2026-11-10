/**
 * The readable text of a chatter message, for the activity feeds.
 *
 * Odoo 17 escapes a plain-string body that arrives over RPC, so the notes the
 * panel posts ("Attachment uploaded: <b>x.jpg</b>") are stored as
 * `&lt;b&gt;x.jpg&lt;/b&gt;` and showed their tags (Anota #5, 9-nov-2026).
 * Two passes of strip-tags + decode undo that; only formatting tags are
 * stripped, so a note that says "width < 30" keeps its text. The result is
 * shown as text, never as HTML.
 */
const TAG = /<\/?(?:b|strong|i|em|u|s|span|font|a|p|div|br|ul|ol|li|h[1-6]|blockquote|pre|code|small|table|tbody|thead|tr|td|th)\b[^>]*>/gi;
const BLOCK_END = /<(?:br\s*\/?|\/(?:p|div|li|h[1-6]|tr|blockquote|pre))>/gi;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function pass(s: string): string {
  return decode(s.replace(BLOCK_END, "\n").replace(TAG, ""));
}

export function messageText(html: string | false | null | undefined): string {
  if (!html) return "";
  return pass(pass(html))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
