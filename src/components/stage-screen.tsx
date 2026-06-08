"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Search, Download, Printer, Filter, Play, Pause, X } from "lucide-react";
import { toast } from "sonner";
import { cn, fmtDate, fmtNum, m2o } from "@/lib/utils";
import { StageWizardModal, STAGE_WIZARDS } from "./stage-wizard-modal";
import { HoldModal } from "./hold-modal";
import { toCsv, downloadCsv } from "@/lib/csv";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/pagination";
// `X` is imported above for the side-panel close affordance.
void X;

interface StageOrder {
  id: number;
  name: string;
  dealer_id: [number, string] | false;
  dealer_ref: string;
  client_name: string;
  client_phone: string;
  client_address: string;
  stage_id: [number, string] | false;
  stage_code: string;
  on_hold: boolean;
  door_count: number;
  total_sqf: number;
  total_dealer_charge: number;
  is_overdue: boolean;
  days_in_current_stage: number;
  installation_date: string | false;
  expected_completion_date: string | false;
  create_date: string;
}

export interface StageScreenColumn {
  key: keyof StageOrder | "design";
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: StageOrder) => React.ReactNode;
}

export interface StageScreenProps {
  title: string;
  subtitle: string;
  stageCode: string | string[];
  kpis: Array<{
    label: string;
    code: string | "all";
    color: string;
  }>;
  columns: StageScreenColumn[];
  advanceWizard?: string;
  advanceLabel?: string;
}

export function StageScreen({
  title,
  subtitle,
  stageCode,
  kpis,
  columns,
  // advanceWizard kept on the props type for callers that still pass it,
  // but the modal now picks the wizard config from the selected row's
  // stage_code via STAGE_WIZARDS, so this prop is effectively a hint only.
  advanceLabel,
}: StageScreenProps) {
  const [selected, setSelected] = useState<StageOrder | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const qc = useQueryClient();

  const stageParam = Array.isArray(stageCode) ? stageCode.join(",") : stageCode;
  const paramKey = Array.isArray(stageCode) ? "stages" : "stage";

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useQuery<{ records: StageOrder[]; total: number }>({
    queryKey: ["stage-orders", stageParam, debouncedQ, page, pageSize],
    queryFn: async () => {
      const url = new URL("/api/orders", window.location.origin);
      url.searchParams.set(paramKey, stageParam);
      if (debouncedQ) url.searchParams.set("q", debouncedQ);
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(page * pageSize));
      const r = await fetch(url);
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  const records = data?.records ?? [];
  const total = data?.total ?? 0;

  // "all" uses the global total from the API (not the per-page slice).
  // The per-stage / on-hold counters still come from the visible page,
  // since we don't have a server-side breakdown — when there's a
  // future need, swap these for a dedicated aggregation endpoint.
  const counters: Record<string, number> = {
    all: total,
  };
  records.forEach((r) => {
    counters[r.stage_code] = (counters[r.stage_code] ?? 0) + 1;
    if (r.on_hold) counters["on_hold"] = (counters["on_hold"] ?? 0) + 1;
  });

  // Look up the wizard config from the SELECTED row's stage code — that way
  // the modal shows the right title/fields even if we list multiple stages.
  const wizardCfg = selected
    ? STAGE_WIZARDS[selected.stage_code]
    : undefined;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              if (!records.length) return toast.warning("Nothing to export");
              const csv = toCsv(records, [
                { header: "Order #", value: (r) => r.name },
                { header: "Client", value: (r) => r.client_name },
                { header: "Dealer", value: (r) => m2o(r.dealer_id)?.name ?? "" },
                { header: "Address", value: (r) => r.client_address?.replace(/\n/g, " ") ?? "" },
                { header: "Phone", value: (r) => r.client_phone },
                { header: "Doors", value: (r) => r.door_count },
                { header: "SQF", value: (r) => r.total_sqf },
                { header: "Days in stage", value: (r) => r.days_in_current_stage },
                { header: "Overdue", value: (r) => (r.is_overdue ? "yes" : "no") },
              ]);
              downloadCsv(
                `${title.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`,
                csv,
              );
              toast.success(`Exported ${records.length} rows`);
            }}
          >
            <Download size={14} /> Export
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              if (!records.length) return toast.warning("Nothing to print");
              openOdooReport({
                report: REPORTS.orderCard,
                ids: records.map((r) => r.id),
                filename: `${title.toLowerCase().replace(/\s+/g, "-")}.pdf`,
              });
            }}
          >
            <Printer size={14} /> Print / PDF
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => toast.info("Advanced filter panel coming soon — use the search box.")}
          >
            <Filter size={14} /> Filters
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full`}
                style={{ background: kpi.color }}
              />
              {kpi.label}
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">
              {fmtNum(counters[kpi.code] ?? 0)}
            </div>
            <div className="text-xs text-slate-400">orders</div>
          </div>
        ))}
      </section>

      <div className="relative">
        <Search
          size={16}
          className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
        />
        <Input
          type="search"
          placeholder="Search by order, client or reference..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* LIST */}
        <div
          className={cn(
            "overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm",
            selected ? "lg:col-span-8" : "lg:col-span-12",
          )}
        >
          <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                {columns.map((c) => (
                  <th
                    key={String(c.key)}
                    className={cn(
                      "px-4 py-3",
                      c.align === "right" && "text-right",
                    )}
                  >
                    {c.label}
                  </th>
                ))}
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="p-12 text-center text-slate-400"
                  >
                    Loading...
                  </td>
                </tr>
              )}
              {!isLoading && records.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="p-12 text-center text-slate-400"
                  >
                    No orders in this stage
                  </td>
                </tr>
              )}
              {records.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className={cn(
                    "cursor-pointer border-t border-slate-100 transition hover:bg-slate-50",
                    selected?.id === r.id && "bg-indigo-50/40",
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={String(c.key)}
                      className={cn(
                        "px-4 py-3",
                        c.align === "right" && "text-right",
                      )}
                    >
                      {c.render
                        ? c.render(r)
                        : ((r[c.key as keyof StageOrder] as React.ReactNode) ?? "—")}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    {r.on_hold ? (
                      <Badge variant="secondary" className="bg-amber-50 text-[10px] font-bold uppercase text-amber-700">
                        On hold
                      </Badge>
                    ) : r.is_overdue ? (
                      <Badge variant="secondary" className="bg-rose-50 text-[10px] font-bold uppercase text-rose-700">
                        Overdue
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-emerald-50 text-[10px] font-bold uppercase text-emerald-700">
                        Ready
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(0);
            }}
          />
        </div>

        {/* SIDE PANEL */}
        {selected && (
          <aside className="space-y-4 lg:col-span-4">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Order
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                  className="text-slate-400"
                >
                  <X size={14} />
                </Button>
              </div>
              <div className="mb-3 flex items-center justify-between">
                <Link
                  href={`/orders/${selected.id}`}
                  className="text-2xl font-bold text-indigo-700 hover:underline"
                >
                  {selected.name}
                </Link>
                <Badge variant="secondary" className="bg-emerald-50 text-[10px] font-bold uppercase text-emerald-700">
                  {m2o(selected.stage_id)?.name}
                </Badge>
              </div>

              <dl className="space-y-3 border-t border-slate-100 pt-3 text-sm">
                <SR label="Client" value={selected.client_name} />
                <SR
                  label="Reference"
                  value={selected.dealer_ref || "—"}
                />
                <SR
                  label="Dealer"
                  value={m2o(selected.dealer_id)?.name ?? "—"}
                />
                <SR
                  label="Address"
                  value={
                    <span className="whitespace-pre-line">
                      {selected.client_address}
                    </span>
                  }
                />
                <SR
                  label="Doors"
                  value={fmtNum(selected.door_count)}
                />
                <SR
                  label="Total SQF"
                  value={fmtNum(selected.total_sqf)}
                />
                <SR
                  label="Due Date"
                  value={fmtDate(selected.expected_completion_date as string)}
                />
              </dl>

              {wizardCfg && (
                <div className="mt-5 space-y-2">
                  <Button
                    size="lg"
                    onClick={() => setWizardOpen(true)}
                    className="w-full h-11 shadow shadow-indigo-700/30"
                  >
                    <Play size={14} />
                    {advanceLabel ?? wizardCfg.submitLabel}
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setHoldOpen(true)}
                    className="w-full h-11 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200"
                  >
                    {selected.on_hold ? <Play size={14} /> : <Pause size={14} />}
                    {selected.on_hold ? "Release from Hold" : "Move to Hold"}
                  </Button>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {selected && wizardCfg && (
        <StageWizardModal
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["stage-orders"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            setSelected(null);
          }}
          orderId={selected.id}
          orderName={selected.name}
          config={wizardCfg}
        />
      )}
      {selected && (
        <HoldModal
          open={holdOpen}
          onClose={() => setHoldOpen(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["stage-orders"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
          }}
          orderId={selected.id}
          orderName={selected.name}
          releasing={selected.on_hold}
        />
      )}
    </div>
  );
}

function SR({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  );
}
