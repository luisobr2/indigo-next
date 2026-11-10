"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardPaste, ExternalLink, Repeat, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { colorDot } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { cardImage, imageFromFiles, pastedImage, screenshotName } from "@/lib/clipboard-image";

type Attachment = { id: number; name: string; mimetype: string };

type Props = {
  orderId: number;
  design: [number, string] | null;
  color?: string | null;
  doorType?: string | null;
  /** "Edit order" is open: a screenshot can be pasted (Ctrl+V) or picked. */
  editing: boolean;
};

/**
 * Door image of the order. A picture added from this card (pasted or picked)
 * wins over the catalog render of the design, with a switch to see the render
 * too; other files of the order never show here. While editing, Ctrl+V
 * anywhere on the page attaches the screenshot in the clipboard (Majela,
 * 30-oct and 2-nov-2026).
 */
export function OrderImageCard({ orderId, design, color, doorType, editing }: Props) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  // The catalog URL whose render failed to load (no render for that colour).
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // With both a pasted picture and a catalog render, which one is on show.
  const [view, setView] = useState<"photo" | "catalog">("photo");
  const [busy, setBusy] = useState(false);

  const { data } = useQuery<{ records: Attachment[] }>({
    queryKey: ["order-attachments", orderId],
    queryFn: () => fetch(`/api/orders/${orderId}/attachments`).then((r) => r.json()),
  });
  const photo = cardImage(data?.records ?? []);

  const designId = design?.[0];
  const catalogUrl = designId
    ? `/api/catalog/designs/${designId}/image?${new URLSearchParams({
        ...(color ? { color } : {}),
        ...(doorType ? { type: doorType } : {}),
      }).toString()}`
    : null;
  const hasCatalog = !!catalogUrl && catalogUrl !== failedUrl;
  const showPhoto = !!photo && (view === "photo" || !hasCatalog);
  const showCatalog = hasCatalog && !showPhoto;

  async function upload(file: File, pasted: boolean) {
    if (busy) return;
    setBusy(true);
    const name = screenshotName(file.type, new Date(), pasted ? "screenshot" : "picture");
    const named = new File([file], name, { type: file.type });
    const fd = new FormData();
    fd.append("file", named);
    const promise = fetch(`/api/orders/${orderId}/attachments`, { method: "POST", body: fd })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Upload failed");
        qc.invalidateQueries({ queryKey: ["order-attachments", orderId] });
        qc.invalidateQueries({ queryKey: ["order-activity", orderId] });
        setView("photo");
      })
      .finally(() => setBusy(false));
    toast.promise(promise, {
      loading: "Adding the picture…",
      success: "Picture added to the order",
      error: (e) => (e instanceof Error ? e.message : "Couldn't add the picture."),
    });
  }

  // Majela, 30-oct-2026: a pasted picture could only be removed from Files & Documents.
  async function remove(att: Attachment) {
    if (busy || !confirm(`Remove ${att.name} from the order?`)) return;
    setBusy(true);
    const promise = fetch(`/api/orders/${orderId}/attachments?att=${att.id}`, { method: "DELETE" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Couldn't remove the picture.");
        qc.invalidateQueries({ queryKey: ["order-attachments", orderId] });
      })
      .finally(() => setBusy(false));
    toast.promise(promise, {
      loading: "Removing the picture…",
      success: "Picture removed",
      error: (e) => (e instanceof Error ? e.message : "Couldn't remove the picture."),
    });
  }

  // Re-bound on every render so it always uploads with the current state.
  useEffect(() => {
    if (!editing) return;
    function onPaste(e: ClipboardEvent) {
      const el = e.target instanceof Element ? e.target : null;
      const img = pastedImage(e.clipboardData?.files, Array.from(e.clipboardData?.types ?? []), {
        editable: !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'),
        inDialog: !!el?.closest('[role="dialog"], [role="alertdialog"]'),
      });
      if (!img) return; // anything else pastes as usual
      e.preventDefault();
      upload(img, true);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const shown = showPhoto
    ? { src: `/api/orders/${orderId}/attachments/${photo!.id}`, alt: photo!.name }
    : showCatalog
      ? { src: catalogUrl!, alt: `${design?.[1] ?? ""} — ${color ?? ""}` }
      : null;
  // Click the picture to see it big, here, without a new tab (Anota #7,
  // 9-nov-2026). Not while editing: then a click is for the edit tools.
  const [zoomed, setZoomed] = useState(false);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <Dialog open={zoomed && !!shown && !editing} onOpenChange={setZoomed}>
        <DialogContent className="max-h-[94vh] w-auto max-w-[94vw] p-3 sm:max-w-[94vw]">
          <DialogTitle className="truncate pr-10 text-sm">{shown?.alt}</DialogTitle>
          {shown && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shown.src}
                alt={shown.alt}
                className="max-h-[80vh] max-w-[90vw] rounded-lg bg-white object-contain"
              />
              <a
                href={shown.src}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 justify-self-start text-xs font-semibold text-indigo-700 hover:underline"
              >
                <ExternalLink size={12} /> Open in a new tab
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
      <div
        className={cn(
          "relative flex h-64 items-center justify-center overflow-hidden rounded-xl bg-slate-50",
          editing && "outline-2 outline-dashed outline-offset-2 outline-indigo-300",
        )}
      >
        {shown ? (
          <>
            {/* Fits both a tall door render and a wide screenshot. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={shown.src}
              src={shown.src}
              alt={shown.alt}
              className="h-full w-full object-contain"
              onError={() => showCatalog && setFailedUrl(catalogUrl)}
            />
            {!editing && (
              <button
                type="button"
                onClick={() => setZoomed(true)}
                className="absolute inset-0 cursor-zoom-in"
                aria-label={`See ${shown.alt} bigger`}
                title="Click to enlarge"
              />
            )}
          </>
        ) : (
          !editing && <span className="text-sm text-slate-300">No design image</span>
        )}
        {photo && hasCatalog && (
          <button
            type="button"
            onClick={() => setView(showPhoto ? "catalog" : "photo")}
            className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow ring-1 ring-slate-200 hover:bg-slate-50"
          >
            <Repeat size={13} /> {showPhoto ? "Catalog" : "Pasted"}
          </button>
        )}
        {editing && showPhoto && photo && (
          <button
            type="button"
            onClick={() => remove(photo)}
            disabled={busy}
            aria-label={`Remove ${photo.name}`}
            className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-semibold text-rose-700 shadow ring-1 ring-rose-200 hover:bg-rose-50"
          >
            <Trash2 size={13} /> Remove
          </button>
        )}
        {editing && (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className={cn(
              "absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold",
              shown ? "bg-slate-900/75 text-white hover:bg-slate-900/85" : "text-indigo-700 hover:bg-indigo-50",
              !shown && "inset-y-3",
            )}
          >
            <ClipboardPaste size={14} />
            {busy ? "Adding…" : "Paste a screenshot (Ctrl+V) or click to choose"}
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = imageFromFiles(e.currentTarget.files);
            if (f) upload(f, false);
            e.currentTarget.value = "";
          }}
        />
      </div>
      {color && (
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-500">
          <span className="inline-block h-3 w-3 rounded-full border border-slate-300" style={{ background: colorDot(color) }} />
          <span className="capitalize">{color.replace("_", " ")}</span>
        </div>
      )}
    </div>
  );
}
