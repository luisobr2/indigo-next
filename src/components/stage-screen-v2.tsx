"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Download,
  Printer,
  Filter,
  Play,
  Pause,
  PauseCircle,
  CheckCircle2,
  AlertCircle,
  Clock,
  X,
  Eye,
  MoreVertical,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  List,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn, fmtDate, fmtNum, m2o } from "@/lib/utils";
import { StageWizardModal, STAGE_WIZARDS } from "./stage-wizard-modal";
import { HoldModal } from "./hold-modal";
import { CancelModal } from "./cancel-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toCsv, downloadCsv } from "@/lib/csv";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type SubStatusKey =
  | "ready"
  | "in_progress"
  | "completed"
  | "on_hold"
  | "cancelled";

export interface StageOrderV2 {
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
  // v2 timestamps
  digi_started_at?: string | false;
  digi_done_at?: string | false;
  cnc_started_at?: string | false;
  cnc_done_at?: string | false;
  paint_started_at?: string | false;
  paint_done_at?: string | false;
  cancelled_at?: string | false;
  // Optional first-line summary when the route is called with ?include=lines.
  first_line?: {
    id: number;
    design_id: [number, string] | false;
    paint_sides?: number;
    material?: string;
    thickness?: string;
    door_type?: string;
    color?: string;
  } | null;
}

export interface SubStatusTab {
  key: SubStatusKey;
  label: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon's container box. */
  iconBg: string;
  iconColor: string;
  /** Pill colors for the STATUS column. */
  pillBg: string;
  pillText: string;
  /**
   * When set, this tab filters by `stage_id.code IN stageCodes` instead of
   * by substatus timestamps. Use for screens that span multiple stages
   * (Design Approval = pending/confirmed; Installations = ready/scheduled/done).
   */
  stageCodes?: string[];
}

export interface StageScreenV2Column {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  render: (row: StageOrderV2) => React.ReactNode;
}

export interface StageScreenV2Props {
  title: string;
  subtitle: string;
  /** The Odoo stage code(s) this screen filters. */
  stageCode: string | string[];
  /** Which sub-status namespace this screen operates on. */
  subStatusPrefix?: "digi" | "cnc" | "paint";
  /** Tabs to render. The `all` tab is auto-prepended. */
  tabs: SubStatusTab[];
  /** Action button label on the side panel — "Start CNC Cutting" etc. */
  startActionLabel?: string;
  /** Columns AFTER #Order/Client which stay fixed. */
  columns: StageScreenV2Column[];
  /** Optional design-preview cell builder. */
  designPreview?: (row: StageOrderV2) => React.ReactNode;
  /** Append `?include=lines` to the orders query — hydrates row.first_line. */
  includeLines?: boolean;
}

/* ------------------------------------------------------------------ */
/* Common defaults shared by callers                                   */
/* ------------------------------------------------------------------ */

export const STATUS_PILLS: Record<SubStatusKey, { bg: string; text: string; label: string }> = {
  ready: { bg: "bg-sky-50", text: "text-sky-700", label: "Ready" },
  in_progress: { bg: "bg-amber-50", text: "text-amber-700", label: "In Progress" },
  completed: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Completed" },
  on_hold: { bg: "bg-slate-100", text: "text-slate-600", label: "On Hold" },
  cancelled: { bg: "bg-rose-50", text: "text-rose-700", label: "Cancelled" },
};

/** Derive a sub-status from the order timestamps. */
export function deriveSubStatus(
  row: StageOrderV2,
  prefix: "digi" | "cnc" | "paint" | undefined,
): SubStatusKey {
  if (row.on_hold) return "on_hold";
  if (row.cancelled_at) return "cancelled";
  if (!prefix) return "ready";
  const startedKey = `${prefix}_started_at` as keyof StageOrderV2;
  const doneKey = `${prefix}_done_at` as keyof StageOrderV2;
  if (row[doneKey]) return "completed";
  if (row[startedKey]) return "in_progress";
  return "ready";
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function StageScreenV2({
  title,
  subtitle,
  stageCode,
  subStatusPrefix,
  tabs,
  startActionLabel,
  columns,
  designPreview,
  includeLines,
}: StageScreenV2Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<StageOrderV2 | null>(null);
  const [activeTab, setActiveTab] = useState<SubStatusKey | "all">("all");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<"none" | "status">("status");
  const [view, setView] = useState<"list" | "grid">("list");
  const [bulk, setBulk] = useState<Set<number>>(new Set());

  const stageParam = Array.isArray(stageCode) ? stageCode.join(",") : stageCode;
  const paramKey = Array.isArray(stageCode) ? "stages" : "stage";

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(0);
    setBulk(new Set());
  }, [activeTab]);

  // Build the URL for a given tab — used by both the list query and the
  // per-tab stat counts.
  const buildUrl = (tabKey: SubStatusKey | "all", limit: number, offset: number) => {
    const url = new URL("/api/orders", window.location.origin);
    if (debouncedQ) url.searchParams.set("q", debouncedQ);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    if (includeLines && limit > 1) url.searchParams.set("include", "lines");

    const tab = tabs.find((t) => t.key === tabKey);
    if (tab?.stageCodes && tab.stageCodes.length) {
      url.searchParams.set("stages", tab.stageCodes.join(","));
    } else {
      url.searchParams.set(paramKey, stageParam);
      if (tabKey !== "all") url.searchParams.set("substatus", tabKey);
    }
    return url;
  };

  const { data, isLoading } = useQuery<{
    records: StageOrderV2[];
    total: number;
  }>({
    queryKey: ["stage-v2", stageParam, activeTab, debouncedQ, page, pageSize],
    queryFn: async () => {
      const url = buildUrl(activeTab, pageSize, page * pageSize);
      const r = await fetch(url);
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  const records = data?.records ?? [];
  const total = data?.total ?? 0;

  // Stat counts — one search_count per tab. Run in parallel.
  const statsQ = useQuery<Record<SubStatusKey | "all", number>>({
    queryKey: ["stage-v2-stats", stageParam, debouncedQ],
    queryFn: async () => {
      const keys: Array<SubStatusKey | "all"> = [
        "all",
        ...tabs.map((t) => t.key),
      ];
      const results = await Promise.all(
        keys.map(async (k) => {
          const url = buildUrl(k, 1, 0);
          const r = await fetch(url);
          const j = await r.json();
          return [k, j.total ?? 0] as const;
        }),
      );
      const out = Object.fromEntries(results) as Record<
        SubStatusKey | "all",
        number
      >;
      return out;
    },
  });

  /* ---------------------- Bulk select helpers ---------------------- */

  function toggleBulk(id: number) {
    setBulk((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setBulk((prev) =>
      prev.size === records.length
        ? new Set()
        : new Set(records.map((r) => r.id)),
    );
  }

  /* ---------------------- Groupings ---------------------- */

  const grouped = useMemo(() => {
    if (groupBy === "none") return [{ key: "_", rows: records }];
    const buckets = new Map<SubStatusKey, StageOrderV2[]>();
    for (const r of records) {
      const k = deriveSubStatus(r, subStatusPrefix);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(r);
    }
    const order: SubStatusKey[] = ["ready", "in_progress", "completed", "on_hold", "cancelled"];
    return order
      .filter((k) => buckets.has(k))
      .map((k) => ({ key: k as string, rows: buckets.get(k)! }));
  }, [records, groupBy, subStatusPrefix]);

  /* ---------------------- Side panel actions ---------------------- */

  async function startStage() {
    if (!selected || !subStatusPrefix) return;
    const promise = fetch(`/api/orders/${selected.id}/substatus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: subStatusPrefix, action: "start" }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["stage-v2"] });
      qc.invalidateQueries({ queryKey: ["stage-v2-stats"] });
      return j;
    });
    toast.promise(promise, {
      loading: "Starting…",
      success: `${selected.name} marked in-progress`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  /**
   * "Mark done & advance" — sets the `<prefix>_done_at` timestamp and then
   * opens the stage wizard so the user can confirm the move to the next
   * Odoo stage. When there is no wizard config for this stage we just set
   * done_at and surface success; the next stage move will be handled by
   * the existing Odoo automation.
   */
  async function markDone() {
    if (!selected || !subStatusPrefix) return;
    const wizardConfig = STAGE_WIZARDS[selected.stage_code];
    const promise = fetch(`/api/orders/${selected.id}/substatus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: subStatusPrefix, action: "done" }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["stage-v2"] });
      qc.invalidateQueries({ queryKey: ["stage-v2-stats"] });
      return j;
    });
    toast.promise(promise, {
      loading: "Marking done…",
      success: `${selected.name} marked completed`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
    await promise;
    // Then open the wizard (if any) to move the order to the next stage.
    if (wizardConfig) setWizardOpen(true);
  }

  /* ---------------------- Render ---------------------- */

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fromCount = total === 0 ? 0 : page * pageSize + 1;
  const toCount = Math.min((page + 1) * pageSize, total);

  return (
    <div className="mx-auto max-w-[1700px] space-y-4">
      {/* ---------- Header ---------- */}
      <header className="flex flex-wrap items-end justify-between gap-3">
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
                { header: "SQF", value: (r) => r.total_sqf },
                { header: "Doors", value: (r) => r.door_count },
                { header: "Status", value: (r) => deriveSubStatus(r, subStatusPrefix) },
              ]);
              downloadCsv(
                `${title.toLowerCase().replace(/\s+/g, "-")}-${new Date()
                  .toISOString()
                  .slice(0, 10)}.csv`,
                csv,
              );
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
            size="lg"
            onClick={() =>
              toast.info("Filter drawer coming soon — use Search + tabs for now.")
            }
          >
            <Filter size={14} /> Filters
          </Button>
        </div>
      </header>

      {/* ---------- Iconned KPI cards ---------- */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const count = statsQ.data?.[tab.key] ?? 0;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-3 rounded-2xl bg-white p-4 text-left ring-1 transition",
                activeTab === tab.key
                  ? "ring-2 ring-indigo-300"
                  : "ring-slate-100 hover:ring-indigo-200",
              )}
            >
              <span
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
                  tab.iconBg,
                )}
              >
                <Icon size={20} className={tab.iconColor} />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-500">
                  {tab.label}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums text-slate-900">
                    {fmtNum(count)}
                  </span>
                  <span className="text-xs text-slate-400">orders</span>
                </div>
              </div>
            </button>
          );
        })}
      </section>

      {/* ---------- Tabs + group + view toggle ---------- */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-100">
        <Tab
          label="All"
          count={statsQ.data?.all ?? 0}
          active={activeTab === "all"}
          onClick={() => setActiveTab("all")}
        />
        {tabs.map((t) => (
          <Tab
            key={t.key}
            label={t.label}
            count={statsQ.data?.[t.key] ?? 0}
            active={activeTab === t.key}
            onClick={() => setActiveTab(t.key)}
          />
        ))}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-500">Group by:</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as "none" | "status")}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="none">None</option>
            <option value="status">Status</option>
          </select>
          <div className="flex h-9 overflow-hidden rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "flex h-full w-9 items-center justify-center transition",
                view === "list"
                  ? "bg-indigo-700 text-white"
                  : "bg-white text-slate-500 hover:bg-slate-50",
              )}
              aria-label="List view"
            >
              <List size={14} />
            </button>
            <button
              type="button"
              onClick={() => setView("grid")}
              className={cn(
                "flex h-full w-9 items-center justify-center transition",
                view === "grid"
                  ? "bg-indigo-700 text-white"
                  : "bg-white text-slate-500 hover:bg-slate-50",
              )}
              aria-label="Grid view"
            >
              <LayoutGrid size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ---------- Search ---------- */}
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
          className="h-11 pl-10"
        />
      </div>

      {/* ---------- Body: list + side panel ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* LIST */}
        <div
          className={cn(
            "overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100",
            selected ? "lg:col-span-8" : "lg:col-span-12",
          )}
        >
          {view === "list" ? (
            <ListBody
              loading={isLoading}
              records={records}
              grouped={grouped}
              groupBy={groupBy}
              columns={columns}
              designPreview={designPreview}
              selected={selected}
              setSelected={setSelected}
              bulk={bulk}
              toggleBulk={toggleBulk}
              toggleAll={toggleAll}
              subStatusPrefix={subStatusPrefix}
            />
          ) : (
            <GridBody
              records={records}
              setSelected={setSelected}
              designPreview={designPreview}
              subStatusPrefix={subStatusPrefix}
            />
          )}

          {/* Pagination strip */}
          {total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">
              <span>
                Showing <strong>{fromCount}</strong> to{" "}
                <strong>{toCount}</strong> of <strong>{total}</strong> orders
              </span>
              <div className="flex items-center gap-1">
                <NavBtn
                  onClick={() => setPage(0)}
                  disabled={page === 0}
                  ariaLabel="First page"
                >
                  <ChevronsLeft size={14} />
                </NavBtn>
                <NavBtn
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  ariaLabel="Previous page"
                >
                  <ChevronLeft size={14} />
                </NavBtn>
                {pageButtons(page, totalPages).map((p) =>
                  p === "…" ? (
                    <span key={`gap-${Math.random()}`} className="px-2">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage((p as number) - 1)}
                      className={cn(
                        "inline-flex h-7 min-w-7 items-center justify-center rounded-md text-xs",
                        page === (p as number) - 1
                          ? "bg-indigo-700 font-semibold text-white"
                          : "text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      {p}
                    </button>
                  ),
                )}
                <NavBtn
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page >= totalPages - 1}
                  ariaLabel="Next page"
                >
                  <ChevronRight size={14} />
                </NavBtn>
                <NavBtn
                  onClick={() => setPage(totalPages - 1)}
                  disabled={page >= totalPages - 1}
                  ariaLabel="Last page"
                >
                  <ChevronsRight size={14} />
                </NavBtn>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(0);
                  }}
                  className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs"
                >
                  {[10, 25, 50, 100].map((s) => (
                    <option key={s} value={s}>
                      {s} per page
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* SIDE PANEL */}
        {selected && (
          <aside className="space-y-4 lg:col-span-4">
            <SidePanel
              order={selected}
              prefix={subStatusPrefix}
              onClose={() => setSelected(null)}
              onStart={startStage}
              onHold={() => setHoldOpen(true)}
              onAdvance={() =>
                subStatusPrefix ? markDone() : setWizardOpen(true)
              }
              onCancel={() => setCancelOpen(true)}
              startActionLabel={startActionLabel}
            />
          </aside>
        )}
      </div>

      {/* Wizard + Hold modals */}
      {selected && STAGE_WIZARDS[selected.stage_code] && (
        <StageWizardModal
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["stage-v2"] });
            qc.invalidateQueries({ queryKey: ["stage-v2-stats"] });
            setSelected(null);
          }}
          orderId={selected.id}
          orderName={selected.name}
          config={STAGE_WIZARDS[selected.stage_code]}
        />
      )}
      {selected && (
        <HoldModal
          open={holdOpen}
          onClose={() => setHoldOpen(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["stage-v2"] });
            qc.invalidateQueries({ queryKey: ["stage-v2-stats"] });
          }}
          orderId={selected.id}
          orderName={selected.name}
          releasing={selected.on_hold}
        />
      )}
      {selected && (
        <CancelModal
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["stage-v2"] });
            qc.invalidateQueries({ queryKey: ["stage-v2-stats"] });
          }}
          orderId={selected.id}
          orderName={selected.name}
          restoring={!!selected.cancelled_at}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Tab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative pb-1.5 text-sm font-medium transition",
        active ? "text-indigo-700" : "text-slate-500 hover:text-slate-800",
      )}
    >
      {label}
      <Badge
        variant="secondary"
        className={cn(
          "ml-1.5 text-[10px]",
          active ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600",
        )}
      >
        {fmtNum(count)}
      </Badge>
      {active && (
        <span className="absolute -bottom-0.5 left-0 right-0 h-0.5 rounded-full bg-indigo-700" />
      )}
    </button>
  );
}

function NavBtn({
  onClick,
  disabled,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition",
        disabled
          ? "cursor-not-allowed opacity-40"
          : "hover:bg-slate-100 hover:text-slate-800",
      )}
    >
      {children}
    </button>
  );
}

function pageButtons(current: number, total: number): (number | "…")[] {
  if (total <= 7)
    return Array.from({ length: total }, (_, i) => i + 1);
  const result: (number | "…")[] = [];
  const c = current + 1;
  result.push(1);
  if (c > 3) result.push("…");
  for (let i = Math.max(2, c - 1); i <= Math.min(total - 1, c + 1); i++)
    result.push(i);
  if (c < total - 2) result.push("…");
  result.push(total);
  return result;
}

function ListBody({
  loading,
  records,
  grouped,
  groupBy,
  columns,
  designPreview,
  selected,
  setSelected,
  bulk,
  toggleBulk,
  toggleAll,
  subStatusPrefix,
}: {
  loading: boolean;
  records: StageOrderV2[];
  grouped: Array<{ key: string; rows: StageOrderV2[] }>;
  groupBy: "none" | "status";
  columns: StageScreenV2Column[];
  designPreview?: (row: StageOrderV2) => React.ReactNode;
  selected: StageOrderV2 | null;
  setSelected: (r: StageOrderV2 | null) => void;
  bulk: Set<number>;
  toggleBulk: (id: number) => void;
  toggleAll: () => void;
  subStatusPrefix: "digi" | "cnc" | "paint" | undefined;
}) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    new Set(grouped.map((g) => g.key)),
  );
  useEffect(() => {
    setOpenGroups(new Set(grouped.map((g) => g.key)));
  }, [grouped]);

  function toggleGroup(k: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[1000px] text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2.5 w-8">
              <Checkbox
                checked={bulk.size > 0 && bulk.size === records.length}
                onCheckedChange={toggleAll}
              />
            </th>
            <th className="px-3 py-2.5"># Order</th>
            <th className="px-3 py-2.5">Client / Name</th>
            {designPreview && (
              <th className="px-3 py-2.5">Design Preview</th>
            )}
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "px-3 py-2.5",
                  c.align === "right" && "text-right",
                )}
              >
                {c.label}
              </th>
            ))}
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td
                colSpan={5 + columns.length + (designPreview ? 1 : 0)}
                className="p-12 text-center text-sm text-slate-400"
              >
                Loading…
              </td>
            </tr>
          )}
          {!loading && records.length === 0 && (
            <tr>
              <td
                colSpan={5 + columns.length + (designPreview ? 1 : 0)}
                className="p-12 text-center text-sm text-slate-400"
              >
                No orders in this view
              </td>
            </tr>
          )}
          {groupBy === "none"
            ? records.map((r) => (
                <Row
                  key={r.id}
                  row={r}
                  columns={columns}
                  designPreview={designPreview}
                  selected={selected?.id === r.id}
                  onSelect={() => setSelected(r)}
                  bulkOn={bulk.has(r.id)}
                  toggleBulk={() => toggleBulk(r.id)}
                  subStatusPrefix={subStatusPrefix}
                />
              ))
            : grouped.map(({ key, rows }) => {
                const status = STATUS_PILLS[key as SubStatusKey];
                const open = openGroups.has(key);
                return (
                  <FragmentRows key={key}>
                    <tr className="border-t border-slate-100 bg-slate-50/60">
                      <td
                        colSpan={
                          5 + columns.length + (designPreview ? 1 : 0)
                        }
                        className="px-3 py-1.5"
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroup(key)}
                          className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-slate-900"
                        >
                          {open ? (
                            <ChevronDown size={12} />
                          ) : (
                            <ChevronRight size={12} />
                          )}
                          <span className={cn("rounded-full px-2 py-0.5", status?.bg, status?.text)}>
                            {status?.label ?? key} ({rows.length})
                          </span>
                        </button>
                      </td>
                    </tr>
                    {open &&
                      rows.map((r) => (
                        <Row
                          key={r.id}
                          row={r}
                          columns={columns}
                          designPreview={designPreview}
                          selected={selected?.id === r.id}
                          onSelect={() => setSelected(r)}
                          bulkOn={bulk.has(r.id)}
                          toggleBulk={() => toggleBulk(r.id)}
                          subStatusPrefix={subStatusPrefix}
                        />
                      ))}
                  </FragmentRows>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Row({
  row,
  columns,
  designPreview,
  selected,
  onSelect,
  bulkOn,
  toggleBulk,
  subStatusPrefix,
}: {
  row: StageOrderV2;
  columns: StageScreenV2Column[];
  designPreview?: (row: StageOrderV2) => React.ReactNode;
  selected: boolean;
  onSelect: () => void;
  bulkOn: boolean;
  toggleBulk: () => void;
  subStatusPrefix: "digi" | "cnc" | "paint" | undefined;
}) {
  const sub = deriveSubStatus(row, subStatusPrefix);
  const pill = STATUS_PILLS[sub];
  return (
    <tr
      onClick={onSelect}
      className={cn(
        "cursor-pointer border-t border-slate-100 transition hover:bg-slate-50",
        selected && "bg-indigo-50/40 ring-1 ring-inset ring-indigo-200",
      )}
    >
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={bulkOn} onCheckedChange={toggleBulk} />
      </td>
      <td className="px-3 py-3">
        <Link
          href={`/orders/${row.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-indigo-700 hover:underline"
          title={row.name}
        >
          {row.dealer_ref || row.name}
        </Link>
      </td>
      <td className="px-3 py-3">
        <div className="font-medium text-slate-800">{row.client_name}</div>
        {row.dealer_id && Array.isArray(row.dealer_id) && (
          <div className="text-xs text-slate-500">
            {row.dealer_id[1]} Project
          </div>
        )}
        <div className="text-xs text-slate-400 line-clamp-1">
          {row.client_address}
        </div>
      </td>
      {designPreview && (
        <td className="px-3 py-3">{designPreview(row)}</td>
      )}
      {columns.map((c) => (
        <td
          key={c.key}
          className={cn(
            "px-3 py-3",
            c.align === "right" && "text-right",
            c.align === "center" && "text-center",
          )}
        >
          {c.render(row)}
        </td>
      ))}
      <td className="px-3 py-3">
        <Badge
          variant="secondary"
          className={cn(
            "text-[10px] font-bold uppercase tracking-wide",
            pill.bg,
            pill.text,
          )}
        >
          {pill.label}
        </Badge>
        {row.is_overdue && (
          <AlertCircle
            size={12}
            className="ml-1 inline text-rose-500"
            aria-label="Overdue"
          />
        )}
      </td>
      <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`/orders/${row.id}`}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Open"
          >
            <Eye size={14} />
          </Link>
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="More"
            onClick={() =>
              toast.info("Row context menu coming soon — open the order for actions.")
            }
          >
            <MoreVertical size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function GridBody({
  records,
  setSelected,
  designPreview,
  subStatusPrefix,
}: {
  records: StageOrderV2[];
  setSelected: (r: StageOrderV2) => void;
  designPreview?: (row: StageOrderV2) => React.ReactNode;
  subStatusPrefix: "digi" | "cnc" | "paint" | undefined;
}) {
  if (records.length === 0)
    return (
      <div className="p-12 text-center text-sm text-slate-400">No orders</div>
    );
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {records.map((r) => {
        const sub = deriveSubStatus(r, subStatusPrefix);
        const pill = STATUS_PILLS[sub];
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => setSelected(r)}
            className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-white p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/30"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-indigo-700">
                {r.name}
              </span>
              <Badge
                variant="secondary"
                className={cn("text-[10px]", pill.bg, pill.text)}
              >
                {pill.label}
              </Badge>
            </div>
            <div className="text-sm font-medium text-slate-800">
              {r.client_name}
            </div>
            <div className="text-xs text-slate-500">
              {m2o(r.dealer_id)?.name}
            </div>
            {designPreview && <div>{designPreview(r)}</div>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Side panel                                                         */
/* ------------------------------------------------------------------ */

function SidePanel({
  order,
  prefix,
  onClose,
  onStart,
  onHold,
  onAdvance,
  onCancel,
  startActionLabel,
}: {
  order: StageOrderV2;
  prefix?: "digi" | "cnc" | "paint";
  onClose: () => void;
  onStart: () => void;
  onHold: () => void;
  onAdvance: () => void;
  onCancel: () => void;
  startActionLabel?: string;
}) {
  const sub = deriveSubStatus(order, prefix);
  const pill = STATUS_PILLS[sub];
  // Fetch the order detail to surface design + lines.
  const { data } = useQuery<{
    order: Record<string, unknown>;
    lines: Array<Record<string, unknown>>;
  }>({
    queryKey: ["sidepanel-order", order.id],
    queryFn: () => fetch(`/api/orders/${order.id}`).then((r) => r.json()),
  });

  const firstLine = (data?.lines ?? [])[0] ?? null;
  const designId = (firstLine?.design_id as [number, string] | false) || false;
  const designLabel = designId ? designId[1] : "—";
  const orderRow = (data?.order ?? {}) as {
    line_ids?: number[];
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Order
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={14} />
        </button>
      </header>
      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center gap-2">
          <Link
            href={`/orders/${order.id}`}
            className="text-2xl font-bold text-indigo-700 hover:underline"
            title={order.name}
          >
            {order.dealer_ref || order.name}
          </Link>
          <Badge
            variant="secondary"
            className={cn("text-[10px] font-bold uppercase", pill.bg, pill.text)}
          >
            {pill.label}
          </Badge>
        </div>
        {order.dealer_ref && order.name && (
          <div className="-mt-2 text-[10px] text-slate-400">{order.name}</div>
        )}

        {/* Image */}
        <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
          {designId ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/api/catalog/designs/${designId[0]}/image`}
              alt={designLabel}
              className="h-56 w-full object-contain"
              onError={(e) => {
                const el = e.currentTarget;
                el.style.display = "none";
                (el.nextElementSibling as HTMLElement | null)?.style?.setProperty(
                  "display",
                  "flex",
                );
              }}
            />
          ) : null}
          <div
            className="hidden h-56 w-full items-center justify-center text-xs text-slate-400"
            style={{ display: designId ? "none" : "flex" }}
          >
            No design image
          </div>
        </div>

        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Order Information
        </h3>

        <dl className="space-y-2 text-sm">
          <Row2 label="Client" value={order.client_name} />
          <Row2 label="Reference" value={order.dealer_ref || "—"} />
          <Row2 label="Design" value={designLabel} />
          <Row2 label="Door Type" value={(firstLine?.door_type as string) || "—"} />
          <Row2
            label="Color"
            value={
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full border border-slate-300"
                  style={{
                    background:
                      (firstLine?.color as string) === "white"
                        ? "#fff"
                        : (firstLine?.color as string) === "bronze"
                          ? "#a16207"
                          : (firstLine?.color as string) === "black"
                            ? "#111"
                            : "#cbd5e1",
                  }}
                />
                {(firstLine?.color as string) ?? "—"}
              </span>
            }
          />
          <Row2
            label="Glass"
            value={
              <span>
                {(firstLine?.glass_type as string) || "—"}
                {(firstLine?.glass_privacy as string) === "privacy"
                  ? " · Privacy"
                  : (firstLine?.glass_privacy as string) === "clear"
                    ? " · Clear"
                    : ""}
              </span>
            }
          />
          <Row2
            label="Measurements"
            value={
              <span>
                {(firstLine?.width_label as string) ||
                  String(firstLine?.width ?? "?")}{" "}
                W ×{" "}
                {(firstLine?.height_label as string) ||
                  String(firstLine?.height ?? "?")}{" "}
                H
              </span>
            }
          />
          {prefix === "cnc" && (
            <>
              <Row2 label="Material" value={(firstLine?.material as string) || "—"} />
              <Row2 label="Thickness" value={(firstLine?.thickness as string) || "—"} />
            </>
          )}
          {prefix === "digi" && (
            <Row2
              label="Margins"
              value={
                <span>
                  L: {fmtNum(Number(firstLine?.sidelite_margin_left) || 0)}" · R:{" "}
                  {fmtNum(Number(firstLine?.sidelite_margin_right) || 0)}"
                </span>
              }
            />
          )}
          <Row2 label="SQF" value={fmtNum(order.total_sqf)} />
          <Row2
            label="Due Date"
            value={fmtDate(order.expected_completion_date as string)}
          />
        </dl>

        <div className="border-t border-slate-100 pt-3">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            Actions
          </h3>
          <div className="space-y-2">
            {prefix && sub === "ready" && (
              <Button
                onClick={onStart}
                size="lg"
                className="h-11 w-full justify-between"
              >
                <span className="flex items-center gap-2">
                  <Play size={14} />
                  {startActionLabel ?? `Start ${prefix}`}
                </span>
                <ChevronRight size={14} />
              </Button>
            )}
            {prefix && sub === "in_progress" && (
              <Button
                onClick={onAdvance}
                size="lg"
                className="h-11 w-full justify-between bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <span className="flex items-center gap-2">
                  <CheckCircle2 size={14} />
                  Mark done & advance stage
                </span>
                <ChevronRight size={14} />
              </Button>
            )}
            {!prefix && (
              <Button
                onClick={onAdvance}
                size="lg"
                className="h-11 w-full justify-between"
              >
                <span className="flex items-center gap-2">
                  <Play size={14} />
                  {startActionLabel ?? "Advance stage"}
                </span>
                <ChevronRight size={14} />
              </Button>
            )}
            <Button
              onClick={onHold}
              variant="outline"
              size="lg"
              className="h-11 w-full justify-start"
            >
              {order.on_hold ? (
                <>
                  <Play size={14} />
                  Release from Hold
                </>
              ) : (
                <>
                  <Pause size={14} />
                  Move to Hold
                </>
              )}
            </Button>
            <Button
              onClick={onCancel}
              variant="outline"
              size="lg"
              className={cn(
                "h-11 w-full justify-start",
                order.cancelled_at
                  ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                  : "border-rose-200 text-rose-700 hover:bg-rose-50",
              )}
            >
              {order.cancelled_at ? (
                <>
                  <Play size={14} />
                  Restore Cancelled
                </>
              ) : (
                <>
                  <AlertCircle size={14} />
                  Cancel Order
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row2({
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
