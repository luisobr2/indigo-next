"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
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

/**
 * Send one invoice to QuickBooks again (pending, error or doesn't match).
 * Shared by the invoice page, the order's invoice card and the tables, so the
 * button says and does the same everywhere.
 */
export function useQboRetry() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  async function retry(invoiceId: number) {
    setBusyId(invoiceId);
    try {
      const r = await fetchJson<{ data: { qbo_state: string; qbo_error: string | false } }>(
        `/api/quickbooks/retry/${invoiceId}`,
        { method: "POST" },
      );
      const st = r.data?.qbo_state;
      if (st === "synced" || st === "linked") toast.success("It's in QuickBooks now");
      else if (st === "pending") toast.success("Sent to the queue: it will go to QuickBooks shortly");
      else toast.error(r.data?.qbo_error || "QuickBooks still has a problem with it");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't reach QuickBooks");
    } finally {
      setBusyId(null);
      // Every screen that shows this invoice's QuickBooks state.
      for (const key of ["billing-invoice", "billing-invoices", "qbo-status", "order-invoices", "orders"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    }
  }
  return { retry, busyId };
}

/**
 * "Retry" for an invoice that couldn't go to QuickBooks. Nothing when there is
 * nothing to retry, when QuickBooks is disconnected, or for a role that can't
 * see QuickBooks (the status query answers null for them).
 */
export function QboRetryButton({
  row,
  invoiceId,
  className,
}: {
  row: QboFields;
  invoiceId: number;
  className?: string;
}) {
  const connected = !!useQboStatus().data?.data?.connected;
  const { retry, busyId } = useQboRetry();
  const b = qboBadge(row, { showMissing: connected });
  if (!connected || !b?.canRetry) return null;
  const busy = busyId === invoiceId;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void retry(invoiceId);
      }}
      disabled={busy}
      aria-label="Send this invoice to QuickBooks again"
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60",
        className,
      )}
    >
      <RefreshCw size={11} className={cn(busy && "animate-spin")} />
      {busy ? "Sending…" : row.qbo_state === "pending" ? "Send now" : "Retry"}
    </button>
  );
}
