/** Paste a screenshot into an order (Majela, 30-oct-2026). */

/** First image among the clipboard files, or null. Text pastes carry none. */
export function imageFromFiles(files: ArrayLike<File> | null | undefined): File | null {
  if (!files) return null;
  for (let i = 0; i < files.length; i++) {
    if (files[i].type.startsWith("image/")) return files[i];
  }
  return null;
}

/** Clipboard images all come as "image.png": name it by the (browser) time it was pasted. */
export function screenshotName(type: string, at: Date): string {
  const ext = (type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `screenshot-${stamp}.${ext}`;
}

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

/** Newest picture attached to the order (the list comes newest first). */
export function latestImage<T extends { mimetype: string }>(records: T[]): T | null {
  return records.find((r) => r.mimetype.startsWith("image/")) ?? null;
}
