"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { cn, fmtMoney } from "@/lib/utils";
import type { InvoiceProfit } from "@/lib/costing/types";

/**
 * Invoice page (inside the panel only) → what this invoice leaves: invoiced
 * before tax against the estimated cost of its orders. The PDF and the email
 * the dealer receives don't change.
 */
export function InvoiceProfitCard({ invoiceId }: { invoiceId: number }) {
  const q = useQuery<{ data: InvoiceProfit }>({
    queryKey: ["invoice-profit", invoiceId],
    queryFn: () => fetchJson(`/api/costing/invoices/${invoiceId}`),
    staleTime: 60_000,
  });
  const p = q.data?.data;
  if (!p || !p.orders.length) return null;
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100" aria-label="Profit">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <TrendingUp size={15} className="text-emerald-700" /> Profit <span className="text-xs font-normal text-slate-400">· only here</span>
      </h2>
      <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
        <dt className="text-slate-500">Invoiced (before tax)</dt>
        <dd className="text-right tabular-nums">{fmtMoney(p.revenue)}</dd>
        <dt className="text-slate-500">Estimated cost</dt>
        <dd className="text-right tabular-nums">{fmtMoney(p.cost)}</dd>
        <dt className="border-t border-slate-100 pt-1.5 font-semibold">Margin</dt>
        <dd
          className={cn(
            "border-t border-slate-100 pt-1.5 text-right font-bold tabular-nums",
            p.margin < 0 ? "text-rose-700" : "text-emerald-700",
          )}
        >
          {fmtMoney(p.margin)} <span className="text-xs font-semibold">({p.margin_pct}%)</span>
        </dd>
      </dl>
    </section>
  );
}
