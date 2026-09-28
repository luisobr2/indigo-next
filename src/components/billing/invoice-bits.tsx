"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import type { BillingStatus, InvoiceStatus } from "@/lib/billing/invoice";

const STATUS_CLASS: Record<InvoiceStatus, string> = {
  Draft: "bg-slate-100 text-slate-600",
  "Balance due": "bg-sky-50 text-sky-700",
  Overdue: "bg-orange-50 text-orange-700",
  Paid: "bg-emerald-50 text-emerald-700",
  Cancelled: "bg-zinc-100 text-zinc-500",
};

/** Same words QuickBooks shows on each invoice: Open / Overdue / Paid. */
export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const label = status === "Balance due" ? "Open" : status;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold",
        STATUS_CLASS[status] ?? "bg-slate-100 text-slate-600",
        className,
      )}
    >
      {label}
    </span>
  );
}

export function useBillingStatus() {
  return useQuery<{ data: BillingStatus }>({
    queryKey: ["billing-status"],
    queryFn: () => fetchJson("/api/invoicing/status"),
    staleTime: 60_000,
  });
}

/** Shown where invoicing would appear while it isn't set up yet. */
export function NotReadyBanner({ canSetup }: { canSetup: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span className="flex-1">
        Invoicing from the app isn&apos;t set up yet. Until it is, invoices are made in QuickBooks and
        &ldquo;Invoice&rdquo; below only marks the order as invoiced.
      </span>
      {canSetup ? (
        <Link
          href="/settings#invoicing"
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
        >
          <Settings size={13} /> Set it up
        </Link>
      ) : (
        <span className="text-xs text-amber-700">A manager can set it up in Settings.</span>
      )}
    </div>
  );
}

/** "$1,284.00", the way the invoice prints it. */
export function money(v: number | null | undefined): string {
  const n = Number(v) || 0;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}$${s}`;
}
