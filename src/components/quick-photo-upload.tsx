"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Camera, Image as ImageIcon, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Server-side limit for body upload is ~25 MB; Odoo will reject above. */
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/**
 * Strip the `download=true` flag so anchor clicks open the image inline
 * in a new tab. The attachments API adds the flag to support the
 * FilesDocumentsPanel's download button — we don't want it here.
 */
function viewUrl(url: string): string {
  return url.replace(/[?&]download=true/g, "").replace(/[?&]$/, "");
}

interface Attachment {
  id: number;
  name: string;
  mimetype: string;
  url: string;
}

interface Props {
  orderId: number;
  /** Short context label, shown on the button — e.g. "measurement". */
  context?: string;
}

/**
 * Compact photo upload + recent thumbnails strip designed for the
 * stage-screen-v2 SidePanel.
 *
 * On mobile the `<input capture="environment">` opens the rear camera
 * directly, so an installer in the field can fire a photo without going
 * through the picker. On desktop it falls back to the file picker
 * naturally.
 */
export function QuickPhotoUpload({ orderId, context = "order" }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data } = useQuery<{ records: Attachment[] }>({
    queryKey: ["order-attachments", orderId],
    queryFn: () =>
      fetch(`/api/orders/${orderId}/attachments`).then((r) => r.json()),
    staleTime: 30_000,
  });

  const allAttachments = data?.records ?? [];
  const images = allAttachments.filter((a) => a.mimetype?.startsWith("image/"));
  const recent = images.slice(0, 3);

  async function upload(file: File) {
    // Guard against multi-megapixel phone shots that would hit Odoo's
    // body limit and fail with a confusing 413/500. Tell the user up
    // front so they can pick a lower-res mode.
    if (file.size > MAX_PHOTO_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      toast.error(
        `Photo is ${mb} MB — too large to upload. Drop the camera resolution or use a smaller image (limit 15 MB).`,
        { duration: 7000 },
      );
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    const promise = fetch(`/api/orders/${orderId}/attachments`, {
      method: "POST",
      body: fd,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Upload failed");
        qc.invalidateQueries({ queryKey: ["order-attachments", orderId] });
        qc.invalidateQueries({ queryKey: ["order-activity", orderId] });
        return j;
      })
      .finally(() => setBusy(false));
    toast.promise(promise, {
      loading: "Uploading…",
      success: `${file.name} uploaded`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
          <Camera size={12} className="text-indigo-700" />
          Photos
          {images.length > 0 && (
            <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
              {images.length}
            </span>
          )}
        </h4>
        {images.length > 0 && (
          <Link
            href={`/orders/${orderId}#files`}
            className="flex items-center gap-0.5 text-[10px] font-medium text-indigo-700 hover:underline"
          >
            View all <ArrowRight size={9} />
          </Link>
        )}
      </div>

      {/* Recent thumbnails strip — anchor opens the image inline (we
          strip Odoo's `?download=true` so the browser displays it in a
          new tab instead of triggering a download dialog). */}
      {recent.length > 0 && (
        <div className="mb-2 flex gap-1.5">
          {recent.map((att) => {
            const inline = viewUrl(att.url);
            return (
              <a
                key={att.id}
                href={inline}
                target="_blank"
                rel="noreferrer"
                className="h-12 w-12 flex-none overflow-hidden rounded-md bg-slate-50 ring-1 ring-slate-200 transition hover:ring-indigo-300"
                title={att.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={inline}
                  alt={att.name}
                  className="h-full w-full object-cover"
                />
              </a>
            );
          })}
        </div>
      )}

      {recent.length === 0 && (
        <div className="mb-2 flex h-12 items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-200 text-[10px] text-slate-400">
          <ImageIcon size={12} /> No photos yet
        </div>
      )}

      {/* Hidden input + visible label so we can use `capture` for the
          mobile camera and still style the trigger as a button. */}
      <input
        id={`quick-photo-${orderId}`}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) upload(f);
          e.currentTarget.value = "";
        }}
      />
      <label
        htmlFor={`quick-photo-${orderId}`}
        className={cn(
          "flex h-10 w-full cursor-pointer select-none items-center justify-center gap-2 rounded-lg text-xs font-semibold transition",
          busy
            ? "cursor-not-allowed bg-slate-100 text-slate-400"
            : "bg-indigo-700 text-white shadow shadow-indigo-700/20 hover:bg-indigo-800",
        )}
      >
        <Camera size={14} />
        {busy ? "Uploading…" : `Take ${context} photo`}
      </label>
    </div>
  );
}
