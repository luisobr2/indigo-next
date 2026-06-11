/**
 * Catalog PDF generation — fully client-side using jsPDF.
 *
 * Two report shapes are supported:
 *   1. catalog-sheet : grid of mini-cards (12 per page A4 portrait)
 *                      to show clients the available designs at a glance.
 *   2. design-sheet  : one full page per design with thumbnail, code,
 *                      variants, colors, and a QR code linking back to
 *                      the design detail in the panel.
 *
 * Images are pulled from `/api/catalog/designs/<id>/image` and embedded
 * as base64 — that endpoint is already cached server-side and the
 * resulting PDF stays self-contained (works offline once opened).
 */

import jsPDF from "jspdf";
import QRCode from "qrcode";

export interface PdfFamilyVariant {
  id: number;
  code: string;
  door_type: string;
  hasImage: boolean;
}

export interface PdfFamily {
  family: string;
  variants: PdfFamilyVariant[];
  colors: string[];
}

const COLOR_LABEL: Record<string, string> = {
  white: "White",
  bronze: "Bronze",
  bronze_eco: "Bronze ECO",
  black: "Black",
  custom: "Custom",
};

const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "Single Door",
  DD: "Double Door",
  SDL: "With Sidelites",
  sidelite: "With Sidelites",
};

/**
 * Fetch an image and convert it to a data URL. Returns `null` on any
 * failure so callers can fall back to a placeholder block.
 */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function brandHeader(doc: jsPDF, title: string, subtitle?: string) {
  const pageW = doc.internal.pageSize.getWidth();
  // Indigo brand band
  doc.setFillColor(31, 68, 134); // #1f4486
  doc.rect(0, 0, pageW, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("INDIGO DECORS", 12, 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Production ERP — Catalog", 12, 16);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text(
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    pageW - 12,
    11,
    { align: "right" },
  );
  doc.text("indigodecors.com", pageW - 12, 16, { align: "right" });
  // Title
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, 12, 32);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(subtitle, 12, 38);
  }
}

function brandFooter(doc: jsPDF, pageNum: number, pageTotal: number) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.setDrawColor(226, 232, 240);
  doc.line(12, pageH - 12, pageW - 12, pageH - 12);
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(7);
  doc.text(
    "Indigo Publicity Corp · 2192 NW 26th Ave, Miami, FL 33142 · sales@indigodecors.com",
    12,
    pageH - 7,
  );
  doc.text(`Page ${pageNum} / ${pageTotal}`, pageW - 12, pageH - 7, {
    align: "right",
  });
}

/**
 * Catalog Sheet — grid of mini cards. 4 columns × 3 rows = 12 designs
 * per page, A4 portrait. Good for handing a printed sheet to a dealer
 * or client to pick from.
 */
export async function generateCatalogSheetPdf(
  families: PdfFamily[],
  opts: { filename?: string; subtitle?: string } = {},
): Promise<void> {
  if (!families.length) return;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const COLS = 4;
  const ROWS = 3;
  const PER_PAGE = COLS * ROWS;
  const totalPages = Math.ceil(families.length / PER_PAGE);

  // Pre-fetch all thumbnails in parallel — one per family (use the
  // first variant that has an image). Skipping `await` per card would
  // make the loop async-serial; this version is much faster.
  const thumbs = await Promise.all(
    families.map(async (f) => {
      const v = f.variants.find((x) => x.hasImage) ?? f.variants[0];
      if (!v) return null;
      return fetchAsDataUrl(`/api/catalog/designs/${v.id}/image`);
    }),
  );

  const marginX = 10;
  const marginTop = 42;
  const marginBottom = 18;
  const usableW = pageW - marginX * 2;
  const usableH = pageH - marginTop - marginBottom;
  const cellW = usableW / COLS;
  const cellH = usableH / ROWS;
  const padCard = 2;

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) doc.addPage();
    brandHeader(doc, "Door Catalog", opts.subtitle || `${families.length} designs`);

    for (let i = 0; i < PER_PAGE; i++) {
      const idx = page * PER_PAGE + i;
      if (idx >= families.length) break;
      const f = families[idx];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = marginX + col * cellW + padCard;
      const y = marginTop + row * cellH + padCard;
      const w = cellW - padCard * 2;
      const h = cellH - padCard * 2;

      // Card frame
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, w, h, 2, 2, "FD");

      // Thumbnail strip — top 65% of the card
      const imgH = h * 0.65;
      const thumb = thumbs[idx];
      if (thumb) {
        try {
          doc.addImage(thumb, "JPEG", x + 2, y + 2, w - 4, imgH - 4, undefined, "FAST");
        } catch {
          // Bad image data — draw a placeholder block.
          doc.setFillColor(241, 245, 249);
          doc.rect(x + 2, y + 2, w - 4, imgH - 4, "F");
        }
      } else {
        doc.setFillColor(241, 245, 249);
        doc.rect(x + 2, y + 2, w - 4, imgH - 4, "F");
        doc.setTextColor(148, 163, 184);
        doc.setFontSize(7);
        doc.text("No image", x + w / 2, y + imgH / 2, { align: "center" });
      }

      // Family code (big)
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(f.family, x + 3, y + imgH + 5);

      // Variants (small)
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      const variantLine = f.variants
        .map((v) => DOOR_TYPE_LABEL[v.door_type] || v.door_type)
        .join(" · ");
      doc.text(variantLine.slice(0, 32), x + 3, y + imgH + 9);

      // Colors
      if (f.colors.length) {
        const colorTxt = f.colors
          .map((c) => COLOR_LABEL[c] || c)
          .join(", ");
        doc.setFontSize(6);
        doc.setTextColor(148, 163, 184);
        doc.text(colorTxt.slice(0, 38), x + 3, y + imgH + 13);
      }
    }

    brandFooter(doc, page + 1, totalPages);
  }

  doc.save(opts.filename || `indigo-catalog-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * Design Sheet — one page per design with large thumbnail, all variants,
 * colors, and a QR code linking to the design detail page in the panel.
 * Use case: Mario gets the printed sheet attached to an order so he
 * has the design reference at hand.
 */
export async function generateDesignSheetsPdf(
  families: PdfFamily[],
  opts: {
    filename?: string;
    /** Base URL to encode into the QR (defaults to current origin). */
    appBaseUrl?: string;
  } = {},
): Promise<void> {
  if (!families.length) return;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const baseUrl =
    opts.appBaseUrl ??
    (typeof window !== "undefined" ? window.location.origin : "");

  for (let i = 0; i < families.length; i++) {
    const f = families[i];
    if (i > 0) doc.addPage();
    brandHeader(doc, `Design ${f.family}`, `${f.variants.length} variant${f.variants.length === 1 ? "" : "s"}`);

    const v = f.variants.find((x) => x.hasImage) ?? f.variants[0];
    const imgDataUrl = v
      ? await fetchAsDataUrl(`/api/catalog/designs/${v.id}/image`)
      : null;

    // Big thumbnail — left column
    const thumbX = 14;
    const thumbY = 48;
    const thumbW = 100;
    const thumbH = 130;
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(thumbX, thumbY, thumbW, thumbH, 3, 3, "FD");
    if (imgDataUrl) {
      try {
        doc.addImage(
          imgDataUrl,
          "JPEG",
          thumbX + 2,
          thumbY + 2,
          thumbW - 4,
          thumbH - 4,
          undefined,
          "MEDIUM",
        );
      } catch {
        // ignore — placeholder remains
      }
    }

    // Right column — meta + QR
    const rightX = thumbX + thumbW + 8;
    let cursorY = thumbY + 4;

    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("CONFIGURATIONS", rightX, cursorY);
    cursorY += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    for (const variant of f.variants) {
      const lbl = `${variant.code}  —  ${DOOR_TYPE_LABEL[variant.door_type] || variant.door_type}`;
      doc.text(lbl, rightX, cursorY);
      cursorY += 5;
    }
    cursorY += 4;

    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("AVAILABLE COLORS", rightX, cursorY);
    cursorY += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    if (f.colors.length) {
      doc.text(f.colors.map((c) => COLOR_LABEL[c] || c).join(" · "), rightX, cursorY);
    } else {
      doc.setTextColor(148, 163, 184);
      doc.text("White · Bronze · Black (default palette)", rightX, cursorY);
    }
    cursorY += 12;

    // QR code linking to the catalog detail of the first variant.
    const qrTarget = v
      ? `${baseUrl}/catalog/designs/${v.id}`
      : `${baseUrl}/catalog`;
    try {
      const qrDataUrl = await QRCode.toDataURL(qrTarget, {
        margin: 1,
        width: 200,
        color: { dark: "#1f4486", light: "#ffffff" },
      });
      const qrSize = 38;
      doc.addImage(qrDataUrl, "PNG", rightX, cursorY, qrSize, qrSize);
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text("Scan to view design detail", rightX, cursorY + qrSize + 4);
    } catch {
      // QR failure shouldn't break the sheet
    }

    // Bottom note: dimensions / notes placeholder
    doc.setDrawColor(226, 232, 240);
    doc.line(14, pageW > 200 ? 198 : 200, pageW - 14, pageW > 200 ? 198 : 200);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      "Notes — fabricated by Indigo Decors. Custom finishes available on request. Contact sales@indigodecors.com for pricing.",
      14,
      206,
      { maxWidth: pageW - 28 },
    );

    brandFooter(doc, i + 1, families.length);
  }

  doc.save(opts.filename || `indigo-designs-${new Date().toISOString().slice(0, 10)}.pdf`);
}
