"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Brush,
  Truck,
  ChevronRight,
  Receipt,
  FileText,
  CheckCircle2,
  Printer,
} from "lucide-react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import { toast } from "sonner";
import { fmtMoney, m2o } from "@/lib/utils";
import { paymentLabel } from "@/lib/labels";
import { fetchJson } from "@/lib/fetch-json";
import { ErrorState, EmptyState } from "@/components/state-cards";
import { Skeleton } from "@/components/skeleton";
import {
  StageWizardModal,
  STAGE_WIZARDS,
} from "@/components/stage-wizard-modal";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/pagination";

interface SummaryData {
  cashIn: { paid: number; pending: number };
  cashOut: { settled: number; pending: number };
  counts: { toInvoice: number; outstanding: number; pendingPayouts: number };
  monthStart: string;
}

interface OrderRow {
  id: number;
  name: string;
  dealer_id: [number, string] | false;
  client_name: string;
  total_dealer_charge: number;
  total_sqf: number;
  door_count: number;
  payment_state: "unpaid" | "partial" | "paid";
  date_paid: string | false;
  create_date: string;
  write_date: string;
  invoiced_at?: string | false;
}

interface PayoutBucket {
  contractorId: number;
  name: string;
  pending: number;
  settled: number;
  payouts: Array<{
    id: number;
    name: string;
    date: string;
    amount: number;
    state: "draft" | "approved" | "paid" | "cancel";
    period_start: string | false;
    period_end: string | false;
    lines: Array<{
      id: number;
      order_id: [number, string] | false;
      description: string;
      date_work: string;
      quantity: number;
      rate: number;
      amount: number;
    }>;
  }>;
}

export default function BillingPage() {
  const qc = useQueryClient();
  const [invoiceOrder, setInvoiceOrder] = useState<OrderRow | null>(null);

  const summaryQ = useQuery<SummaryData>({
    queryKey: ["billing-summary"],
    queryFn: () => fetchJson<SummaryData>("/api/billing/summary"),
  });
  const [toInvoicePage, setToInvoicePage] = useState(0);
  const [outstandingPage, setOutstandingPage] = useState(0);
  const PAGE_SIZE = 10;
  const toInvoiceQ = useQuery<{ records: OrderRow[]; total: number }>({
    queryKey: ["billing-to-invoice", toInvoicePage],
    queryFn: () =>
      fetchJson(
        `/api/billing/to-invoice?limit=${PAGE_SIZE}&offset=${toInvoicePage * PAGE_SIZE}`,
      ),
    placeholderData: (prev) => prev,
  });
  const outstandingQ = useQuery<{ records: OrderRow[]; total: number }>({
    queryKey: ["billing-outstanding", outstandingPage],
    queryFn: () =>
      fetchJson(
        `/api/billing/outstanding?limit=${PAGE_SIZE}&offset=${outstandingPage * PAGE_SIZE}`,
      ),
    placeholderData: (prev) => prev,
  });
  const payoutsQ = useQuery<{
    painters: PayoutBucket[];
    installers: PayoutBucket[];
  }>({
    queryKey: ["billing-payouts"],
    queryFn: () =>
      fetchJson<{ painters: PayoutBucket[]; installers: PayoutBucket[] }>(
        "/api/billing/payouts",
      ),
  });
  const revenueQ = useQuery<{ series: Array<{ month: string; label: string; value: number }> }>({
    queryKey: ["billing-revenue"],
    queryFn: () =>
      fetchJson<{ series: Array<{ month: string; label: string; value: number }> }>(
        "/api/billing/revenue-by-month",
      ),
  });

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ["billing-summary"] });
    qc.invalidateQueries({ queryKey: ["billing-to-invoice"] });
    qc.invalidateQueries({ queryKey: ["billing-outstanding"] });
    qc.invalidateQueries({ queryKey: ["billing-payouts"] });
    qc.invalidateQueries({ queryKey: ["billing-revenue"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }

  async function markPaidPending(bucket: PayoutBucket) {
    const pendingIds = bucket.payouts
      .filter((p) => p.state !== "paid")
      .map((p) => p.id);
    if (!pendingIds.length) {
      toast.info("Nothing to settle for this contractor.");
      return;
    }
    // Real-money operation: confirm before marking N payouts as paid.
    // Show the contractor, count and amount so the user sees the scope.
    if (
      !confirm(
        `Mark ${pendingIds.length} payout${pendingIds.length === 1 ? "" : "s"} for ${bucket.name} as paid (${fmtMoney(bucket.pending)})?`,
      )
    ) {
      return;
    }
    const promise = fetch("/api/billing/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "mark-paid", payoutIds: pendingIds }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        refreshAll();
        return j;
      });
    toast.promise(promise, {
      loading: "Settling payouts...",
      success: `${bucket.name} settled (${pendingIds.length} payouts)`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  const summary = summaryQ.data;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Billing
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Cash flow this month, pending invoices and contractor payouts.
          </p>
        </div>
      </div>

      {/* ---------- Summary ---------- */}
      {summaryQ.isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      )}
      {summaryQ.error && (
        <ErrorState
          title="Failed to load summary"
          onRetry={() => summaryQ.refetch()}
        />
      )}
      {summary && (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
              <ArrowDownCircle size={14} />
              Cash IN — this month
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <div className="text-3xl font-bold text-emerald-700">
                  {fmtMoney(summary.cashIn.paid)}
                </div>
                <div className="text-xs text-emerald-700/70">
                  ✓ Paid invoices
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold text-amber-600">
                  {fmtMoney(summary.cashIn.pending)}
                </div>
                <div className="text-xs text-amber-700/70">
                  ⏳ Pending invoice ({summary.counts.toInvoice})
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-indigo-700">
              <ArrowUpCircle size={14} />
              Cash OUT — this month
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <div className="text-3xl font-bold text-indigo-700">
                  {fmtMoney(summary.cashOut.settled)}
                </div>
                <div className="text-xs text-indigo-700/70">
                  ✓ Settled payouts
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold text-amber-600">
                  {fmtMoney(summary.cashOut.pending)}
                </div>
                <div className="text-xs text-amber-700/70">
                  ⏳ Pending payout ({summary.counts.pendingPayouts})
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ---------- To invoice + Outstanding ---------- */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-slate-800">
              <Receipt size={16} className="text-amber-600" />
              To invoice ({toInvoiceQ.data?.total ?? 0})
            </h2>
          </div>
          {toInvoiceQ.isLoading && <Skeleton className="h-40 rounded-xl" />}
          {!toInvoiceQ.isLoading && !toInvoiceQ.data?.records?.length && (
            <EmptyState
              title="All caught up"
              message="No installed orders awaiting invoicing."
            />
          )}
          <ul className="space-y-2">
            {(toInvoiceQ.data?.records ?? []).map((o) => (
              <li
                key={o.id}
                className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 transition hover:bg-amber-50/30"
              >
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/orders/${o.id}`}
                    className="font-semibold text-indigo-700 hover:underline"
                  >
                    {o.name}
                  </Link>
                  <div className="truncate text-sm text-slate-700">
                    {o.client_name}
                  </div>
                  <div className="text-xs text-slate-400">
                    {m2o(o.dealer_id)?.name} · {o.door_count} doors
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-slate-900">
                    {fmtMoney(o.total_dealer_charge)}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => setInvoiceOrder(o)}
                  className="bg-emerald-600 text-white shadow shadow-emerald-600/20 hover:bg-emerald-700"
                >
                  Invoice
                </Button>
              </li>
            ))}
          </ul>
          <Pagination
            page={toInvoicePage}
            pageSize={PAGE_SIZE}
            total={toInvoiceQ.data?.total ?? 0}
            onPageChange={setToInvoicePage}
            hideOnSinglePage
          />
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-slate-800">
              <FileText size={16} className="text-rose-600" />
              Outstanding ({outstandingQ.data?.total ?? 0})
            </h2>
          </div>
          {outstandingQ.isLoading && <Skeleton className="h-40 rounded-xl" />}
          {!outstandingQ.isLoading && !outstandingQ.data?.records?.length && (
            <EmptyState
              title="No outstanding balance"
              message="Every invoiced order is paid in full."
            />
          )}
          <ul className="space-y-2">
            {(outstandingQ.data?.records ?? []).map((o) => {
              // Age from when it was invoiced (stable), falling back to
              // write_date only for orders invoiced before invoiced_at existed.
              const ref = (o.invoiced_at || o.write_date) as string | false;
              const since = typeof ref === "string"
                ? ref.replace(" ", "T") + (/[zZ]|[+-]\d\d:\d\d$/.test(ref) ? "" : "Z")
                : null;
              const daysSinceInvoiced = since
                ? Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000)
                : null;
              return (
                <li
                  key={o.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 transition hover:bg-rose-50/30"
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/orders/${o.id}`}
                      className="font-semibold text-indigo-700 hover:underline"
                    >
                      {o.name}
                    </Link>
                    <div className="truncate text-sm text-slate-700">
                      {o.client_name}
                    </div>
                    <div className="text-xs text-slate-400">
                      {m2o(o.dealer_id)?.name} ·{" "}
                      {daysSinceInvoiced !== null
                        ? `${daysSinceInvoiced}d`
                        : "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-slate-900">
                      {fmtMoney(o.total_dealer_charge)}
                    </div>
                    <div
                      className={`text-[10px] font-bold uppercase ${
                        o.payment_state === "partial"
                          ? "text-amber-700"
                          : "text-rose-700"
                      }`}
                    >
                      {paymentLabel(o.payment_state)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination
            page={outstandingPage}
            pageSize={PAGE_SIZE}
            total={outstandingQ.data?.total ?? 0}
            onPageChange={setOutstandingPage}
            hideOnSinglePage
          />
        </div>
      </section>

      {/* ---------- Payouts ---------- */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PayoutCard
          title="Painter payouts"
          icon={Brush}
          iconColor="text-orange-600"
          bg="bg-orange-50/30"
          buckets={payoutsQ.data?.painters ?? []}
          loading={payoutsQ.isLoading}
          onSettle={markPaidPending}
        />
        <PayoutCard
          title="Installer payouts"
          icon={Truck}
          iconColor="text-emerald-600"
          bg="bg-emerald-50/30"
          buckets={payoutsQ.data?.installers ?? []}
          loading={payoutsQ.isLoading}
          onSettle={markPaidPending}
        />
      </section>

      {/* ---------- Revenue by month ---------- */}
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-800">
          Revenue by month — last 6
        </h2>
        {revenueQ.isLoading ? (
          <Skeleton className="h-56" />
        ) : (
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={revenueQ.data?.series ?? []}>
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  tickFormatter={(v) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                />
                <Tooltip
                  formatter={(v) => fmtMoney(Number(v))}
                  labelStyle={{ color: "#1f4486" }}
                />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {(revenueQ.data?.series ?? []).map((_, i, arr) => (
                    <Cell
                      key={i}
                      fill={i === arr.length - 1 ? "#1f4486" : "#5a7cc8"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* ---------- Invoice & Mark Paid wizard ---------- */}
      {invoiceOrder && STAGE_WIZARDS.installed && (
        <StageWizardModal
          open={!!invoiceOrder}
          onClose={() => setInvoiceOrder(null)}
          onSuccess={refreshAll}
          orderId={invoiceOrder.id}
          orderName={invoiceOrder.name}
          config={STAGE_WIZARDS.installed}
        />
      )}
    </div>
  );
}

function PayoutCard({
  title,
  icon: Icon,
  iconColor,
  bg,
  buckets,
  loading,
  onSettle,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconColor: string;
  bg: string;
  buckets: PayoutBucket[];
  loading: boolean;
  onSettle: (b: PayoutBucket) => void;
}) {
  const totalPending = buckets.reduce((s, b) => s + b.pending, 0);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800">
          <Icon size={16} className={iconColor} />
          {title}
        </h2>
        <span className="text-sm font-bold text-slate-900">
          Pending: {fmtMoney(totalPending)}
        </span>
      </div>
      {loading && <Skeleton className="h-40 rounded-xl" />}
      {!loading && buckets.length === 0 && (
        <EmptyState title="No payouts yet" />
      )}
      <ul className="space-y-3">
        {buckets.map((b) => (
          <li key={b.contractorId} className={`rounded-xl ${bg} p-3`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-900">{b.name}</div>
                <div className="text-xs text-slate-500">
                  {b.payouts.filter((p) => p.state !== "paid").length} pending ·{" "}
                  {b.payouts.filter((p) => p.state === "paid").length} settled
                </div>
              </div>
              <div className="text-right">
                <div className="text-base font-bold text-amber-700">
                  {fmtMoney(b.pending)}
                </div>
                <div className="text-[10px] text-slate-500">
                  settled: {fmtMoney(b.settled)}
                </div>
              </div>
            </div>
            <details className="group">
              <summary className="flex cursor-pointer items-center gap-1 text-xs font-medium text-indigo-700 hover:underline">
                <ChevronRight
                  size={12}
                  className="transition group-open:rotate-90"
                />
                View {b.payouts.length} payout
                {b.payouts.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {b.payouts.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-100"
                  >
                    <span className="font-mono text-slate-600">{p.name}</span>
                    <span className="text-slate-500">{p.date}</span>
                    <span className="font-semibold">{fmtMoney(p.amount)}</span>
                    <Badge
                      variant="secondary"
                      className={`text-[9px] font-bold uppercase ${
                        p.state === "paid"
                          ? "bg-emerald-100 text-emerald-700"
                          : p.state === "approved"
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {p.state}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() =>
                        openOdooReport({
                          report: "indigo_decors.report_payout_doc",
                          ids: p.id,
                          filename: `${p.name}.pdf`,
                        })
                      }
                      title="Print receipt"
                    >
                      <Printer size={12} />
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
            {b.pending > 0 && (
              <Button
                size="sm"
                onClick={() => onSettle(b)}
                className="mt-3"
              >
                <CheckCircle2 size={12} />
                Pay all pending ({fmtMoney(b.pending)})
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
