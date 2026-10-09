"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { cn, fmtMoney } from "@/lib/utils";
import type { OrderCost } from "@/lib/costing/types";

/**
 * Order page → what this door costs to make, with the fixed rates Majela
 * gave (Settings → Cost per door) plus painting and digitization already
 * paid. An estimate: the real figures are per month, on Billing → Costs.
 * Office and managers only (the page passes it only to them).
 */
export function OrderCostCard({ orderId }: { orderId: number }) {
  const q = useQuery<{ data: OrderCost }>({
    queryKey: ["order-cost", orderId],
    queryFn: () => fetchJson(`/api/costing/orders/${orderId}`),
    staleTime: 60_000,
  });
  const c = q.data?.data;
  if (q.isError || (!q.isLoading && !c)) return null;

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm" aria-labelledby={`order-cost-${orderId}`}>
      <h2 id={`order-cost-${orderId}`} className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Calculator size={15} className="text-indigo-700" /> Estimated cost
      </h2>
      {!c ? (
        <p className="mt-2 text-sm text-slate-400">Calculating…</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-50 px-2 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Cost</dt>
              <dd className="font-bold tabular-nums text-slate-900">{fmtMoney(c.total)}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-2 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Per SQF</dt>
              <dd className="font-bold tabular-nums text-slate-900">{fmtMoney(c.per_sqf)}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-2 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Margin</dt>
              <dd className={cn("font-bold tabular-nums", c.margin < 0 ? "text-rose-700" : "text-emerald-700")}>
                {fmtMoney(c.margin)}
              </dd>
            </div>
          </dl>
          {(["material", "labor"] as const).map((g) => (
            <div key={g} className="mt-3">
              <div className="flex justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>{g === "material" ? "Materials" : "Labor"}</span>
                <span className="tabular-nums">{fmtMoney(g === "material" ? c.materials : c.labor)}</span>
              </div>
              <ul className="mt-1 space-y-0.5 text-sm">
                {c.lines
                  .filter((l) => l.group === g)
                  .map((l) => (
                    <li key={l.label} className="flex justify-between gap-2">
                      <span className="text-slate-700">
                        {l.label} <span className="text-xs text-slate-400">{l.detail}</span>
                      </span>
                      <span className="tabular-nums text-slate-700">{fmtMoney(l.amount)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <p className="mt-3 text-xs text-slate-400">
            Sold to the dealer for {fmtMoney(c.price)}. Rates in{" "}
            <Link href="/settings#cost-rates" className="text-indigo-700 hover:underline">
              Settings
            </Link>
            ; the real month is in{" "}
            <Link href="/billing/costs" className="text-indigo-700 hover:underline">
              Billing → Costs
            </Link>
            .
          </p>
        </>
      )}
    </section>
  );
}
