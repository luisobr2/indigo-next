"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, FileSpreadsheet, History, Search, X } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";

import {
  auditQuery,
  dayHeading,
  groupByDay,
  presetRange,
  recordHref,
  rowTime,
  shopDay,
  type AuditPage,
  type AuditRow,
  type DatePreset,
} from "@/lib/activity-log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/state-cards";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const NONE_OPEN = new Set<number>();
const EXPORT_CAP = 5000;

const ACTION_BADGE: Record<string, string> = {
  create: "bg-emerald-50 text-emerald-700",
  write: "bg-indigo-50 text-indigo-700",
  unlink: "bg-rose-50 text-rose-700",
  note: "bg-slate-100 text-slate-700",
  attachment: "bg-amber-50 text-amber-700",
  login: "bg-sky-50 text-sky-700",
  login_failed: "bg-rose-50 text-rose-700",
};

const PRESETS: Array<{ key: DatePreset; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

const SELECT =
  "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100";

function initials(name: string) {
  return (name || "?")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function ActivityLogPage() {
  const [module, setModule] = useState("");
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [preset, setPreset] = useState<DatePreset>("7d");
  const [custom, setCustom] = useState(() => {
    const today = shopDay(new Date());
    return { from: today, to: today };
  });
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");

  // Typing doesn't fire a request per key.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const range = preset === "custom" ? custom : presetRange(preset);
  const filters = useMemo(
    () => ({ module, user_id: userId, action, q, date_from: range.from, date_to: range.to }),
    [module, userId, action, q, range.from, range.to],
  );
  // Page and open rows belong to one set of filters: change a filter and
  // you are back on the first page with everything folded.
  const filterKey = JSON.stringify(filters);
  const [view, setView] = useState({ key: filterKey, page: 0, open: new Set<number>() });
  const page = view.key === filterKey ? view.page : 0;
  const open = view.key === filterKey ? view.open : NONE_OPEN;
  const setPage = (next: number) => setView({ key: filterKey, page: next, open: new Set() });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<AuditPage>({
    queryKey: ["activity-log", filters, page],
    queryFn: () =>
      fetchJson<AuditPage>(`/api/admin/activity-log?${auditQuery({ ...filters, offset: page * PAGE_SIZE, limit: PAGE_SIZE })}`),
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const groups = useMemo(() => groupByDay(rows), [rows]);
  const moduleLabel = useMemo(() => Object.fromEntries((data?.modules ?? []).map((m) => [m.key, m.label])), [data]);
  const actionLabel = useMemo(() => Object.fromEntries((data?.actions ?? []).map((a) => [a.key, a.label])), [data]);
  const filtered = Boolean(module || userId || action || q || preset !== "7d");

  function clearFilters() {
    setModule("");
    setUserId("");
    setAction("");
    setQInput("");
    setQ("");
    setPreset("7d");
  }

  function toggle(id: number) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setView({ key: filterKey, page, open: next });
  }

  // The workbook is built on the server (same search as the screen); here we
  // only fetch it and hand it to the browser as a download.
  async function exportExcel() {
    const p = fetch(`/api/admin/activity-log/export?${auditQuery(filters)}`).then(async (r) => {
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || "Export failed");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `activity-log-${shopDay(new Date())}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    toast.promise(p, {
      loading: "Preparing the Excel file…",
      success: total > EXPORT_CAP ? `Exported the newest ${EXPORT_CAP} of ${total} actions` : `Exported ${total} actions`,
      error: (e) => (e instanceof Error ? e.message : "Export failed"),
    });
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Activity log</h1>
          <p className="mt-1 text-sm text-slate-500">
            Who did what and when: changes, notes, files and sign-ins across the system.
          </p>
        </div>
        <Button variant="outline" size="lg" onClick={exportExcel} disabled={!total}>
          <FileSpreadsheet size={14} /> Export to Excel
        </Button>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        {/* Module tabs */}
        <div className="flex flex-wrap gap-1 border-b border-slate-100 px-3 pt-2" role="tablist" aria-label="Filter by module">
          {[{ key: "", label: "All" }, ...(data?.modules ?? [])].map((m) => (
            <button
              key={m.key || "all"}
              type="button"
              role="tab"
              aria-selected={module === m.key}
              onClick={() => setModule(m.key)}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium transition",
                module === m.key ? "border-indigo-700 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label="Date range">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={preset === p.key}
                onClick={() => setPreset(p.key)}
                className={cn(
                  "whitespace-nowrap rounded-md px-2.5 py-1 text-sm transition",
                  preset === p.key ? "bg-indigo-700 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="flex items-center gap-1.5 text-sm text-slate-500">
              <Input
                id="log-from"
                type="date"
                aria-label="From"
                value={custom.from}
                max={custom.to || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="h-9 w-40"
              />
              to
              <Input
                id="log-to"
                type="date"
                aria-label="To"
                value={custom.to}
                min={custom.from || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="h-9 w-40"
              />
            </div>
          )}
          <select id="log-user" aria-label="User" value={userId} onChange={(e) => setUserId(e.target.value)} className={SELECT}>
            <option value="">All people</option>
            {(data?.users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select id="log-action" aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)} className={SELECT}>
            <option value="">All actions</option>
            {(data?.actions ?? []).map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              id="log-search"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search order, client, invoice, person…"
              className="h-9 pl-8"
            />
          </div>
          {filtered && (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
              <X size={14} /> Clear filters
            </button>
          )}
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Loading…</div>
        ) : isError ? (
          <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700">
            {error instanceof Error ? error.message : "Couldn't load the activity log."}{" "}
            <button className="underline" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        ) : !rows.length ? (
          <div className="p-4">
            <EmptyState
              icon={History}
              title="No activity"
              message={filtered ? "Nothing matches these filters. Try a wider date range." : "Nothing has been recorded yet."}
            />
          </div>
        ) : (
          <div className={cn("transition-opacity", isFetching && "opacity-60")}>
            <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-500">
              <span>
                <span className="font-semibold tabular-nums text-slate-700">{total.toLocaleString("en-US")}</span>{" "}
                {total === 1 ? "action" : "actions"}
              </span>
              <span className="tabular-nums">
                {(page * PAGE_SIZE + 1).toLocaleString("en-US")}–{Math.min(total, (page + 1) * PAGE_SIZE).toLocaleString("en-US")}
              </span>
            </div>
            {groups.map((g) => (
              <Fragment key={g.day}>
                <div className="border-y border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
                  {dayHeading(g.day)}
                </div>
                <ul className="divide-y divide-slate-100">
                  {g.rows.map((r) => (
                    <LogRow
                      key={r.id}
                      row={r}
                      open={open.has(r.id)}
                      onToggle={() => toggle(r.id)}
                      moduleLabel={moduleLabel[r.module] ?? r.module}
                      actionLabel={actionLabel[r.action] ?? r.action}
                    />
                  ))}
                </ul>
              </Fragment>
            ))}
            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  <ChevronLeft size={14} /> Newer
                </Button>
                <span className="text-sm tabular-nums text-slate-500">
                  Page {page + 1} of {pages}
                </span>
                <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
                  Older <ChevronRight size={14} />
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function LogRow({
  row,
  open,
  onToggle,
  moduleLabel,
  actionLabel,
}: {
  row: AuditRow;
  open: boolean;
  onToggle: () => void;
  moduleLabel: string;
  actionLabel: string;
}) {
  const href = row.action === "unlink" ? null : recordHref(row.res_model, row.res_id);
  const expandable = row.changes.length > 0;
  return (
    <li>
      <div
        className={cn(
          "flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-sm sm:flex-nowrap",
          expandable && "cursor-pointer hover:bg-slate-50",
        )}
        onClick={expandable ? onToggle : undefined}
      >
        <span className="w-16 flex-none pt-0.5 text-xs tabular-nums text-slate-500">{rowTime(row)}</span>
        <span className="flex w-44 flex-none items-center gap-2 truncate">
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
            {initials(row.user_name)}
          </span>
          <span className="truncate text-slate-800">{row.user_name || "Unknown"}</span>
        </span>
        <span className="w-28 flex-none">
          <span className={cn("inline-block rounded-md px-2 py-0.5 text-xs font-medium", ACTION_BADGE[row.action] ?? "bg-slate-100 text-slate-700")}>
            {actionLabel}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {row.res_name &&
              (href ? (
                <Link
                  href={href}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-indigo-700 hover:underline"
                >
                  {row.record_type} {row.res_name}
                </Link>
              ) : (
                <span className="font-medium text-slate-800">
                  {row.record_type} {row.res_name}
                </span>
              ))}
            <span className="text-xs text-slate-500">{moduleLabel}</span>
          </div>
          {row.summary && <p className="mt-0.5 break-words text-slate-600">{row.summary}</p>}
        </div>
        {expandable && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Hide changes" : "Show changes"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="flex-none rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>
      {open && expandable && (
        <div className="px-4 pb-4 sm:pl-[19.5rem]">
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">Before</th>
                  <th className="px-3 py-2 font-medium">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {row.changes.map((c) => (
                  <tr key={c.field} className="align-top">
                    <td className="px-3 py-2 text-slate-700">{c.label}</td>
                    <td className="px-3 py-2 break-words text-slate-500">{c.old || <span className="italic text-slate-400">empty</span>}</td>
                    <td className="px-3 py-2 break-words text-slate-900">{c.new || <span className="italic text-slate-400">empty</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </li>
  );
}
