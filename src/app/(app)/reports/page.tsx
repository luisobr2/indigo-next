"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  TrendingUp,
  Building2,
  Layers,
  Brush,
  Wrench,
  Clock,
  Download,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { fmtMoney, fmtNum, fmtDate, fmtDateTime } from "@/lib/utils";
import { TableSkeleton } from "@/components/skeleton";
import { ErrorState } from "@/components/state-cards";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ReportsData {
  topDealers: Array<{
    id: number;
    name: string;
    orderCount: number;
    paidRevenue: number;
    pendingRevenue: number;
    totalSqf: number;
  }>;
  revenue: Array<{ month: string; label: string; value: number }>;
  stageAging: Array<{ id: number; name: string; count: number; avgDays: number }>;
  topDesigns: Array<{
    id: number;
    name: string;
    orderCount: number;
    doors: number;
    sqf: number;
  }>;
  contractorPerformance: Array<{
    id: number;
    name: string;
    type: "painter" | "installer" | "other";
    payoutCount: number;
    paid: number;
  }>;
  windowStart: string;
  generatedAt: string;
}

const NOW_MONTH = new Date().toISOString().slice(0, 7);
// Prior calendar month (UTC, same basis as NOW_MONTH) — looked up by key so
// the delta compares the right months even if the series has a gap.
const PREV_MONTH = (() => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
})();

export default function ReportsPage() {
  const { data, isLoading, error, refetch } = useQuery<ReportsData>({
    queryKey: ["reports"],
    queryFn: async () => {
      const r = await fetch("/api/reports");
      if (!r.ok) throw new Error("Failed to load reports");
      return r.json();
    },
  });

  if (error) {
    return (
      <ErrorState
        title="Couldn't load reports"
        message={error instanceof Error ? error.message : "Unknown error"}
        onRetry={() => refetch()}
      />
    );
  }

  function exportAll() {
    if (!data) return;
    const csv = toCsv(data.topDealers, [
      { header: "Dealer", value: (d) => d.name },
      { header: "Orders", value: (d) => d.orderCount },
      { header: "Total SQF", value: (d) => d.totalSqf },
      { header: "Paid revenue (USD)", value: (d) => d.paidRevenue },
      { header: "Pending revenue (USD)", value: (d) => d.pendingRevenue },
    ]);
    downloadCsv(`indigo-top-dealers-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast.success(`Exported ${data.topDealers.length} dealers`);
  }

  // Print the full analytics report — all four ranking tables on one sheet.
  function printReport() {
    if (!data) return;
    const w = window.open("", "_blank");
    if (!w) return toast.error("Allow pop-ups to print the report");
    const esc = (v: unknown) =>
      String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
    const section = (
      title: string,
      headers: Array<{ label: string; right?: boolean }>,
      rows: string[][],
    ) =>
      `<h2>${esc(title)}</h2>` +
      (rows.length
        ? `<table><thead><tr>${headers.map((h) => `<th${h.right ? ' class="r"' : ""}>${esc(h.label)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows
            .map(
              (r) =>
                `<tr>${r.map((cell, i) => `<td${headers[i]?.right ? ' class="r"' : ""}>${esc(cell)}</td>`).join("")}</tr>`,
            )
            .join("")}</tbody></table>`
        : `<p class="empty">No data</p>`);
    const body =
      section(
        "Top dealers",
        [{ label: "Dealer" }, { label: "Orders", right: true }, { label: "SQF", right: true }, { label: "Paid", right: true }, { label: "Pending", right: true }],
        data.topDealers.map((d) => [d.name, String(d.orderCount), fmtNum(d.totalSqf), fmtMoney(d.paidRevenue), fmtMoney(d.pendingRevenue)]),
      ) +
      section(
        "Top designs",
        [{ label: "Design" }, { label: "Orders", right: true }, { label: "Doors", right: true }, { label: "SQF", right: true }],
        data.topDesigns.map((d) => [d.name, String(d.orderCount), String(d.doors), fmtNum(d.sqf)]),
      ) +
      section(
        "Stage aging (active orders)",
        [{ label: "Stage" }, { label: "Count", right: true }, { label: "Avg days", right: true }],
        data.stageAging.map((s) => [s.name, String(s.count), `${s.avgDays}d`]),
      ) +
      section(
        "Contractor performance (8 wks)",
        [{ label: "Contractor" }, { label: "Type" }, { label: "Payouts", right: true }, { label: "Paid", right: true }],
        data.contractorPerformance.map((c) => [c.name, c.type, String(c.payoutCount), fmtMoney(c.paid)]),
      );
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>Indigo Decors — Reports</title>
      <style>
        body{margin:22px;color:#111;font-family:Arial,Helvetica,sans-serif;}
        h1{font-size:18px;margin:0 0 2px;color:#1f4486;}
        h2{font-size:13px;margin:18px 0 6px;color:#1f4486;}
        .sub{font-size:11px;color:#555;margin-bottom:6px;}
        .empty{font-size:11px;color:#999;}
        table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:6px;}
        th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;}
        th{background:#1f4486;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        td.r,th.r{text-align:right;white-space:nowrap;}
        @page{size:portrait;margin:12mm;}
      </style></head><body>
      <h1>Indigo Decors — Analytics report</h1>
      <div class="sub">Last 6 months · Generated ${esc(new Date().toLocaleString())}</div>
      ${body}
      <script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>
      </body></html>`);
    w.document.close();
  }

  const totalRevenue6m = data?.revenue.reduce((s, m) => s + m.value, 0) ?? 0;
  const currentMonthRev = data?.revenue.find((r) => r.month === NOW_MONTH)?.value ?? 0;
  const prevMonthRev = data?.revenue.find((r) => r.month === PREV_MONTH)?.value ?? 0;
  const monthDelta = prevMonthRev > 0 ? ((currentMonthRev - prevMonthRev) / prevMonthRev) * 100 : 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-slate-500 text-xs uppercase tracking-wider font-semibold">
            <BarChart3 size={14} />
            Reports
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Analytics & insights
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Last 6 months · Top dealers, designs, stage aging and contractor performance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={printReport}
            disabled={!data}
          >
            <Printer size={14} />
            Print report
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={exportAll}
            disabled={!data}
          >
            <Download size={14} />
            Export top dealers
          </Button>
        </div>
      </header>

      {/* ---------- KPIs ---------- */}
      <section className="grid gap-4 sm:grid-cols-3">
        <KpiTile
          icon={TrendingUp}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
          label="Revenue last 6 mo"
          value={fmtMoney(totalRevenue6m)}
          sub={`Avg ${fmtMoney(totalRevenue6m / 6)}/month`}
        />
        <KpiTile
          icon={TrendingUp}
          iconColor={monthDelta >= 0 ? "text-indigo-700" : "text-rose-600"}
          iconBg={monthDelta >= 0 ? "bg-indigo-50" : "bg-rose-50"}
          label="Current month"
          value={fmtMoney(currentMonthRev)}
          sub={
            prevMonthRev > 0
              ? `${monthDelta >= 0 ? "▲" : "▼"} ${Math.abs(monthDelta).toFixed(1)}% vs prior month`
              : "No baseline yet"
          }
        />
        <KpiTile
          icon={Building2}
          iconColor="text-violet-700"
          iconBg="bg-violet-50"
          label="Active dealers"
          value={fmtNum(data?.topDealers.length ?? 0)}
          sub="Dealers with orders in window"
        />
      </section>

      {/* ---------- Revenue chart ---------- */}
      <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Revenue by month</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Paid orders only (date_paid in window). Current month highlighted.
            </p>
          </div>
        </div>
        <div className="h-64">
          {isLoading ? (
            <div className="h-full animate-pulse rounded-xl bg-slate-100" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.revenue ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  stroke="#cbd5e1"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  stroke="#cbd5e1"
                  tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`}
                />
                <Tooltip
                  cursor={{ fill: "rgba(31, 68, 134, 0.04)" }}
                  formatter={(v) => fmtMoney(Number(v))}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {(data?.revenue ?? []).map((entry) => (
                    <Cell
                      key={entry.month}
                      fill={entry.month === NOW_MONTH ? "#1f4486" : "#94a3b8"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* ---------- Top dealers + Top designs ---------- */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card title="Top dealers" icon={Building2}>
          {isLoading ? (
            <TableSkeleton rows={5} cols={4} />
          ) : data?.topDealers.length === 0 ? (
            <Empty msg="No dealer activity in window" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="px-2 py-2 text-left">Dealer</th>
                    <th className="px-2 py-2 text-right">Orders</th>
                    <th className="px-2 py-2 text-right">SQF</th>
                    <th className="px-2 py-2 text-right">Paid</th>
                    <th className="px-2 py-2 text-right">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.topDealers.map((d, i) => (
                    <tr key={d.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-600">
                            {i + 1}
                          </span>
                          <span className="font-medium text-slate-800">{d.name}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{d.orderCount}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtNum(d.totalSqf)}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-emerald-700">
                        {fmtMoney(d.paidRevenue)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-amber-700">
                        {fmtMoney(d.pendingRevenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Top designs" icon={Layers}>
          {isLoading ? (
            <TableSkeleton rows={5} cols={3} />
          ) : data?.topDesigns.length === 0 ? (
            <Empty msg="No design activity in window" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="px-2 py-2 text-left">Design</th>
                    <th className="px-2 py-2 text-right">Orders</th>
                    <th className="px-2 py-2 text-right">Doors</th>
                    <th className="px-2 py-2 text-right">SQF</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.topDesigns.map((d, i) => (
                    <tr key={d.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-600">
                            {i + 1}
                          </span>
                          <span className="font-medium text-slate-800">{d.name}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{d.orderCount}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{d.doors}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtNum(d.sqf)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* ---------- Stage aging + Contractor performance ---------- */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card title="Stage aging (active orders)" icon={Clock}>
          {isLoading ? (
            <TableSkeleton rows={5} cols={3} />
          ) : data?.stageAging.length === 0 ? (
            <Empty msg="No active orders" />
          ) : (
            <ul className="space-y-2">
              {data?.stageAging.map((s) => {
                const slow = s.avgDays >= 5;
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800">{s.name}</div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className={`h-full ${slow ? "bg-rose-500" : "bg-indigo-600"}`}
                          style={{ width: `${Math.min(100, s.count * 8)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold tabular-nums text-slate-900">{s.count}</div>
                      <div className={`text-[10px] tabular-nums ${slow ? "text-rose-600 font-semibold" : "text-slate-500"}`}>
                        {s.avgDays}d avg
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Contractor performance (8 wks)" icon={Brush}>
          {isLoading ? (
            <TableSkeleton rows={5} cols={3} />
          ) : data?.contractorPerformance.length === 0 ? (
            <Empty msg="No settled payouts in window" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="px-2 py-2 text-left">Contractor</th>
                    <th className="px-2 py-2 text-left">Type</th>
                    <th className="px-2 py-2 text-right">Payouts</th>
                    <th className="px-2 py-2 text-right">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.contractorPerformance.map((c) => (
                    <tr key={c.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-2 py-2 font-medium text-slate-800">{c.name}</td>
                      <td className="px-2 py-2">
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-semibold uppercase ${
                            c.type === "painter"
                              ? "bg-orange-50 text-orange-700"
                              : c.type === "installer"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {c.type === "painter" ? (
                            <Brush size={10} />
                          ) : c.type === "installer" ? (
                            <Wrench size={10} />
                          ) : null}
                          {c.type}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{c.payoutCount}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-slate-900">
                        {fmtMoney(c.paid)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <p className="text-center text-[10px] text-slate-400">
        Window: from {data?.windowStart ? fmtDate(data.windowStart) : "—"} to today · Generated {data?.generatedAt ? fmtDateTime(data.generatedAt) : ""}
      </p>
    </div>
  );
}

function KpiTile({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  sub,
}: {
  icon: typeof BarChart3;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
          {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg} ${iconColor}`}>
          <Icon size={16} />
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof BarChart3;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
        <Icon size={16} className="text-slate-500" />
        {title}
      </h3>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/30 px-3 py-8 text-center text-xs text-slate-400">
      {msg}
    </div>
  );
}
