/** Paste a screenshot into an order (Majela, 30-oct-2026). */

/** First image among the clipboard files, or null. Text pastes carry none. */
export function imageFromFiles(files: ArrayLike<File> | null | undefined): File | null {
  if (!files) return null;
  for (let i = 0; i < files.length; i++) {
    if (files[i].type.startsWith("image/")) return files[i];
  }
  return null;
}

/** Clipboard images all come as "image.png": name it by the shop time it was pasted. */
export function screenshotName(type: string, at: Date): string {
  const ext = (type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `screenshot-${stamp}.${ext}`;
}

/** Newest picture attached to the order (the list comes newest first). */
export function latestImage<T extends { mimetype: string }>(records: T[]): T | null {
  return records.find((r) => r.mimetype.startsWith("image/")) ?? null;
}
