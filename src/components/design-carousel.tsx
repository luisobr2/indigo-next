"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DesignImage {
  id: number;
  name: string;
  mimetype: string;
}

interface Props {
  designId: number | null;
  /** Fallback for designs with no attachments — usually `data.designImage`. */
  fallbackUrl?: string | null;
  className?: string;
}

/**
 * Image carousel for a design's attachments. Falls back to a single
 * preview image (the `image_1920` field) when there are no
 * `ir.attachment` records.
 */
export function DesignCarousel({ designId, fallbackUrl, className }: Props) {
  const [idx, setIdx] = useState(0);
  const { data, isLoading } = useQuery<{ records: DesignImage[] }>({
    queryKey: ["design-images", designId],
    queryFn: () =>
      fetch(`/api/catalog/designs/${designId}/images`).then((r) => r.json()),
    enabled: !!designId,
    staleTime: 60_000,
  });

  const images = data?.records ?? [];
  const hasMultiple = images.length > 1;
  const empty = !designId || (!images.length && !fallbackUrl);

  const url = images.length
    ? `/api/catalog/designs/${designId}/image?att=${images[idx % images.length]?.id}`
    : fallbackUrl ?? null;

  return (
    <div className={cn("rounded-2xl border border-slate-100 bg-white p-3 shadow-sm", className)}>
      <div className="relative flex h-64 items-center justify-center overflow-hidden rounded-xl bg-slate-50">
        {empty ? (
          <div className="flex flex-col items-center gap-1 text-slate-300">
            <ImageIcon size={32} />
            <span className="text-xs">No design image</span>
          </div>
        ) : isLoading ? (
          <div className="text-xs text-slate-400">Loading…</div>
        ) : url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={url}
            src={url}
            alt="Design"
            className="h-full w-auto object-contain"
          />
        ) : null}

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={() => setIdx((p) => (p - 1 + images.length) % images.length)}
              className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/95 p-2 text-slate-700 shadow ring-1 ring-slate-200 hover:bg-white"
              aria-label="Previous image"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => setIdx((p) => (p + 1) % images.length)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/95 p-2 text-slate-700 shadow ring-1 ring-slate-200 hover:bg-white"
              aria-label="Next image"
            >
              <ChevronRight size={16} />
            </button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/70 px-2.5 py-0.5 text-[10px] font-medium text-white">
              {idx + 1} / {images.length}
            </div>
          </>
        )}
      </div>

      {hasMultiple && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setIdx(i)}
              className={cn(
                "h-12 w-12 overflow-hidden rounded-md ring-2 transition",
                i === idx ? "ring-indigo-700" : "ring-transparent hover:ring-slate-200",
              )}
              aria-label={`Image ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/catalog/designs/${designId}/image?att=${img.id}`}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
