"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, FileText, Landmark, Receipt, Search } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { fmtDate, cn } from "@/lib/utils";
import { presetRange, type InvoiceRow, type InvoiceSummary } from "@/lib/billing/invoice";
import { KpiCard } from "@/components/kpi-card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/skeleton";
import { EmptyState, ErrorState } from "@/components/state-cards";
import { InvoiceStatusBadge, money } from "@/components/billing/invoice-bits";

type Status = "all" | "open" | "overdue" | "paid" | "draft";
const STATUS_TABS: Array<{ key: Status; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "draft", label: "Drafts" },
];
type Preset = "this-month" | "last-month" | "this-year" | "custom";

/**
 * Every invoice made in the app, with the summary for the chosen dates:
 * what was invoiced, the sales tax in it, what came in and what is still
 * open. That summary "by a date I can enter" is what Majela asked for.
 */
export default function InvoicesPage() {
  const [preset, setPreset] = useState<Preset>("this-month");
  const [range, setRange] = useState(presetRange("this-month"));
  const [status, setStatus] = useState<Status>("all");
  const [dealer, setDealer] = useState("");
  const [q, setQ] = useState("");

  const params = useMemo(() => {
    const p = new URLSearchParams({ status });
    if (range.from) p.set("from", range.from);
    if (range.to) p.set("to", range.to);
    if (dealer) p.set("dealer", dealer);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [range, status, dealer, q]);

  const listQ = useQuery<{ data: { rows: InvoiceRow[]; summary: InvoiceSummary } }>({
    queryKey: ["billing-invoices", params],
    queryFn: () => fetchJson(`/api/invoicing/invoices?${params}`),
  });
  const dealersQ = useQuery<{ records: Array<{ id: number; name: string }> }>({
    queryKey: ["catalog-dealers"],
    queryFn: () => fetchJson("/api/catalog/dealers"),
    staleTime: 5 * 60_000,
  });

  function pick(p: Preset) {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  }

  const s = listQ.data?.data.summary;
  const rows = listQ.data?.data.rows ?? [];

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Invoices</h1>
          <p className="mt-1 text-sm text-slate-500">Invoices made in the app, and the totals for the dates you pick.</p>
        </div>
        <Link href="/billing" className="text-sm font-medium text-indigo-700 hover:underline">
          ← Billing
        </Link>
      </header>

      <section className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100">
        {(["this-month", "last-month", "this-year", "custom"] as Preset[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => pick(p)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              preset === p ? "bg-indigo-700 text-white" : "text-slate-600 hover:bg-slate-50",
            )}
          >
            {p === "this-month" ? "This month" : p === "last-month" ? "Last month" : p === "this-year" ? "This year" : "Custom"}
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <Input
            id="inv-from"
            type="date"
            value={range.from}
            onChange={(e) => {
              setPreset("custom");
              setRange({ ...range, from: e.target.value });
            }}
            className="h-9 w-38"
          />
          <span className="text-slate-400">–</span>
          <Input
            id="inv-to"
            type="date"
            value={range.to}
            onChange={(e) => {
              setPreset("custom");
              setRange({ ...range, to: e.target.value });
            }}
            className="h-9 w-38"
          />
        </div>
        <select
          id="inv-dealer"
          value={dealer}
          onChange={(e) => setDealer(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
        >
          <option value="">All dealers</option>
          {(dealersQ.data?.records ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="relative ml-auto w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input id="inv-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, dealer or client…" className="h-9 pl-8" />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Invoiced" value={money(s?.total)} hint={`${s?.count ?? 0} invoices`} icon={Receipt} />
        <KpiCard label="Sales tax" value={money(s?.tax)} hint="In those invoices" icon={Landmark} iconBg="bg-slate-100" iconColor="text-slate-600" />
        <KpiCard label="Collected" value={money(s?.collected)} hint="Paid so far" icon={CircleDollarSign} iconBg="bg-emerald-50" iconColor="text-emerald-700" />
        <KpiCard label="Open" value={money(s?.open)} hint="Still to collect" icon={FileText} iconBg="bg-orange-50" iconColor="text-orange-600" />
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-wrap gap-1 border-b border-slate-100 px-3 pt-2">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatus(t.key)}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium transition",
                status === t.key ? "border-indigo-700 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {listQ.isLoading && <Skeleton className="m-4 h-40 rounded-xl" />}
        {listQ.error && <ErrorState title="Couldn't load invoices" onRetry={() => listQ.refetch()} />}
        {!listQ.isLoading && !listQ.error && !rows.length && (
          <div className="p-4">
            <EmptyState title="No invoices" message="Nothing matches these dates and filters." />
          </div>
        )}
        {!!rows.length && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Invoice</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Dealer</th>
                  <th className="px-3 py-2.5">Orders</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5 text-right">Balance</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5">
                      <Link href={`/billing/invoices/${r.id}`} className="font-semibold text-indigo-700 hover:underline">
                        {r.name ? `#${r.name}` : "Draft"}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{r.invoice_date ? fmtDate(r.invoice_date) : "—"}</td>
                    <td className="px-3 py-2.5">
                      {r.dealer ? (
                        <Link href={`/billing/dealers/${r.dealer[0]}`} className="text-slate-700 hover:text-indigo-700 hover:underline">
                          {r.dealer[1]}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2.5 text-xs text-slate-500" title={r.order_names.join(", ")}>
                      {r.order_names.join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{money(r.total)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{r.state === "posted" ? money(r.residual) : "—"}</td>
                    <td className="px-3 py-2.5">
                      <InvoiceStatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
