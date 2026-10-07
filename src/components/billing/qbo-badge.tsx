"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { qboBadge, type QboFields, type QboTone } from "@/lib/quickbooks/badge";
import type { QboStatus } from "@/components/billing/quickbooks-settings";

const TONE: Record<QboTone, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  info: "bg-sky-50 text-sky-700",
  warn: "bg-amber-50 text-amber-800",
  bad: "bg-rose-50 text-rose-700",
  muted: "bg-slate-100 text-slate-600",
};

/**
 * QuickBooks status for the panel: null when the module isn't installed (404)
 * or the role can't see it (403), so screens simply leave QuickBooks out.
 * Shared key with Settings, so one fetch serves every screen.
 */
export function useQboStatus() {
  return useQuery<{ data: QboStatus } | null>({
    queryKey: ["qbo-status"],
    queryFn: async () => {
      const res = await fetch("/api/quickbooks/status");
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Couldn't load QuickBooks");
      return res.json();
    },
    retry: false,
    staleTime: 60_000,
  });
}

/** The invoice's QuickBooks state as a pill; nothing when there's nothing to say. */
export function QboBadge({ row, showMissing, className }: { row: QboFields; showMissing?: boolean; className?: string }) {
  const b = qboBadge(row, { showMissing });
  if (!b) return null;
  return (
    <span
      title={b.detail ?? undefined}
      className={cn("inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold", TONE[b.tone], className)}
    >
      {b.label}
    </span>
  );
}
