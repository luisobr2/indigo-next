/** Paste a screenshot into an order (Majela, 30-oct-2026). */

/** First image among the clipboard files, or null. Text pastes carry none. */
export function imageFromFiles(files: ArrayLike<File> | null | undefined): File | null {
  if (!files) return null;
  for (let i = 0; i < files.length; i++) {
    if (files[i].type.startsWith("image/")) return files[i];
  }
  return null;
}

/**
 * Clipboard images all come as "image.png": name it by the (browser) time it
 * was added. The prefix ("screenshot" pasted, "picture" picked) is what tells
 * the image card its own pictures apart from the rest of the order's files.
 */
export function screenshotName(type: string, at: Date, prefix: "screenshot" | "picture" = "screenshot"): string {
  const ext = (type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `${prefix}-${stamp}.${ext}`;
}

const CARD_NAME = /^(screenshot|picture)-\d{8}-\d{6}\.[a-z0-9]+$/i;

/**
 * The image a paste should attach, or null to let the paste go on as usual:
 * - inside a dialog it belongs to that dialog, not to the order;
 * - in a text field with text on the clipboard it is a text paste, even when
 *   the source (Excel, Word) also put a picture of it there.
 * A screenshot carries no text, so it is taken even with a field focused.
 */
export function pastedImage(
  files: ArrayLike<File> | null | undefined,
  types: readonly string[],
  target: { editable: boolean; inDialog: boolean },
): File | null {
  if (target.inDialog) return null;
  if (target.editable && types.includes("text/plain")) return null;
  return imageFromFiles(files);
}

/**
 * Newest picture added from the image card (the list comes newest first).
 * Photos uploaded in Files & Documents (contract, install) don't count.
 */
export function cardImage<T extends { name: string; mimetype: string }>(records: T[]): T | null {
  return records.find((r) => r.mimetype.startsWith("image/") && CARD_NAME.test(r.name)) ?? null;
}
