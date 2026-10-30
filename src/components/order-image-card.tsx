"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardPaste } from "lucide-react";
import { colorDot } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { imageFromFiles, latestImage, screenshotName } from "@/lib/clipboard-image";

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
 * Door image of the order. The catalog render of its design wins; with no
 * design (or no render) it falls back to the newest picture attached to the
 * order. While editing, Ctrl+V anywhere on the page attaches the screenshot
 * in the clipboard (Majela, 30-oct-2026).
 */
export function OrderImageCard({ orderId, design, color, doorType, editing }: Props) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  // The catalog URL whose render failed to load (no render for that colour).
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery<{ records: Attachment[] }>({
    queryKey: ["order-attachments", orderId],
    queryFn: () => fetch(`/api/orders/${orderId}/attachments`).then((r) => r.json()),
  });
  const photo = latestImage(data?.records ?? []);

  const designId = design?.[0];
  const catalogUrl = designId
    ? `/api/catalog/designs/${designId}/image?${new URLSearchParams({
        ...(color ? { color } : {}),
        ...(doorType ? { type: doorType } : {}),
      }).toString()}`
    : null;
  const showCatalog = !!catalogUrl && catalogUrl !== failedUrl;

  async function upload(file: File, pasted: boolean) {
    if (busy) return;
    setBusy(true);
    const named = pasted ? new File([file], screenshotName(file.type, new Date()), { type: file.type }) : file;
    const fd = new FormData();
    fd.append("file", named);
    const promise = fetch(`/api/orders/${orderId}/attachments`, { method: "POST", body: fd })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Upload failed");
        qc.invalidateQueries({ queryKey: ["order-attachments", orderId] });
        qc.invalidateQueries({ queryKey: ["order-activity", orderId] });
      })
      .finally(() => setBusy(false));
    toast.promise(promise, {
      loading: "Adding the picture…",
      success: showCatalog
        ? "Picture added to Files & Documents (the catalog image stays here)"
        : "Picture added to the order",
      error: (e) => (e instanceof Error ? e.message : "Couldn't add the picture."),
    });
  }

  // Re-bound on every render so it always uploads with the current state.
  useEffect(() => {
    if (!editing) return;
    function onPaste(e: ClipboardEvent) {
      const img = imageFromFiles(e.clipboardData?.files);
      if (!img) return; // text pastes go on to the field as usual
      e.preventDefault();
      upload(img, true);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const shown = showCatalog
    ? { src: catalogUrl!, alt: `${design?.[1] ?? ""} — ${color ?? ""}` }
    : photo
      ? { src: `/api/orders/${orderId}/attachments/${photo.id}`, alt: photo.name }
      : null;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div
        className={cn(
          "relative flex h-64 items-center justify-center overflow-hidden rounded-xl bg-slate-50",
          editing && "outline-2 outline-dashed outline-offset-2 outline-indigo-300",
        )}
      >
        {shown ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={shown.src}
            src={shown.src}
            alt={shown.alt}
            className="h-full w-auto object-contain"
            onError={() => showCatalog && setFailedUrl(catalogUrl)}
          />
        ) : (
          !editing && <span className="text-sm text-slate-300">No design image</span>
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
