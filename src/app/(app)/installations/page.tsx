"use client";

import { useMemo, useState, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Users,
  FolderOpen,
  CheckSquare,
  PieChart as PieIcon,
  Search,
  Download,
  Printer,
  Columns3,
  Plus,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  CircleDollarSign,
  AlertTriangle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, fmtNum, fmtDate, cn } from "@/lib/utils";
import { toCsv, downloadCsv } from "@/lib/csv";
import { fetchJson } from "@/lib/fetch-json";
import { ErrorState } from "@/components/state-cards";
import { AddInstallerModal } from "@/components/add-installer-modal";
import {
  ScheduleInstallationModal,
  type ScheduleTarget,
} from "@/components/schedule-installation-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkSendToButton } from "@/components/bulk-send-to-button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  PieChart as RPieChart,
  Pie,
} from "recharts";

interface DashboardData {
  rangeStart: string;
  rangeEnd: string;
  ratePerDoor: number;
  summary: {
    totalInstallers: number;
    doorsToInstall: number;
    installedThisWeek: number;
    pendingThisWeek: number;
    scheduled: number;
    paymentDue: number;
  };
  installers: Array<{
    id: number;
    name: string;
    doors: number;
    installed: number;
    pending: number;
    paymentDue: number;
    orders: Array<{
      id: number;
      name: string;
      dealer_ref: string;
      client_name: string;
      client_address: string;
      door_type: string;
      color: string;
      qty: number;
      status: "installed" | "scheduled" | "pending";
      scheduled_date: string | false;
    }>;
  }>;
  unscheduled: Array<{
    id: number;
    name: string;
    dealer_ref: string;
    client_name: string;
    client_phone: string | false;
    client_address: string;
    door_type: string;
    color: string;
    qty: number;
    stage_code: string;
    installer: string;
    installer_ids: number[];
  }>;
  overdue: Array<{
    id: number;
    name: string;
    dealer_ref: string;
    client_name: string;
    client_address: string;
    door_type: string;
    qty: number;
    scheduled_date: string;
    days_overdue: number;
    installer: string;
    installer_ids: number[];
  }>;
  days: Array<{
    date: string;
    label: string;
    installed: number;
    pending: number;
    not_scheduled: number;
  }>;
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date) {
  const day = (d.getDay() + 6) % 7;
  const r = new Date(d);
  r.setDate(d.getDate() - day);
  r.setHours(0, 0, 0, 0);
  return r;
}

// Format a YYYY-MM-DD as a local date (avoids the UTC off-by-one that
// fmtDate hits on date-only strings, which would disagree with days_overdue).
function fmtYmd(ymdStr: string) {
  const [y, m, d] = ymdStr.split("-").map(Number);
  if (!y) return ymdStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Parse a YYYY-MM-DD as a LOCAL date (new Date("YYYY-MM-DD") is UTC and would
// shift a day back in Miami's negative offset).
function parseYmd(ymdStr: string) {
  const [y, m, d] = ymdStr.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function formatRange(start: string, end: string) {
  const s = parseYmd(start);
  const e = parseYmd(end);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString(
    "en-US",
    { ...opts, year: "numeric" },
  )}`;
}

const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "Single Door",
  DD: "Double Door",
  sidelite: "Door with Sidelites",
};

// ----- Configurable columns for the Pending Scheduling table -----
type PendingRow = DashboardData["unscheduled"][number];
interface PendCol {
  key: string;
  label: string;
  thClass?: string;
  cell: (o: PendingRow) => ReactNode;
  print: (o: PendingRow) => string;
  sortVal: (o: PendingRow) => string | number;
}
const PEND_COLUMNS: PendCol[] = [
  {
    key: "order",
    label: "Order #",
    cell: (o) => (
      <Link
        href={`/orders/${o.id}`}
        className="font-mono text-xs font-semibold text-indigo-700 hover:underline"
        title={o.name}
      >
        {o.dealer_ref || o.name}
      </Link>
    ),
    print: (o) => o.dealer_ref || o.name,
    sortVal: (o) => o.dealer_ref || o.name,
  },
  {
    key: "client",
    label: "Client Name",
    cell: (o) => <span className="text-slate-700">{o.client_name}</span>,
    print: (o) => o.client_name,
    sortVal: (o) => (o.client_name || "").toLowerCase(),
  },
  {
    key: "phone",
    label: "Phone",
    cell: (o) => <span className="whitespace-nowrap text-xs text-slate-600">{(o.client_phone as string) || "—"}</span>,
    print: (o) => (o.client_phone as string) || "",
    sortVal: (o) => (o.client_phone as string) || "",
  },
  {
    key: "address",
    label: "Address",
    cell: (o) => <span className="text-xs text-slate-600">{o.client_address || "—"}</span>,
    print: (o) => (o.client_address || "").replace(/\n/g, " "),
    sortVal: (o) => (o.client_address || "").toLowerCase(),
  },
  {
    key: "door",
    label: "Door Type",
    cell: (o) => <span className="text-xs text-slate-700">{DOOR_TYPE_LABEL[o.door_type] ?? o.door_type ?? "—"}</span>,
    print: (o) => DOOR_TYPE_LABEL[o.door_type] ?? o.door_type ?? "",
    sortVal: (o) => o.door_type || "",
  },
  {
    key: "qty",
    label: "Qty",
    thClass: "text-right",
    cell: (o) => <span className="font-mono text-xs">{o.qty}</span>,
    print: (o) => String(o.qty),
    sortVal: (o) => o.qty,
  },
  {
    key: "installer",
    label: "Installer",
    cell: (o) =>
      o.installer === "Unassigned" ? (
        <span className="text-xs text-amber-700">Unassigned</span>
      ) : (
        <span className="text-xs text-slate-600">{o.installer}</span>
      ),
    print: (o) => o.installer,
    sortVal: (o) => (o.installer || "").toLowerCase(),
  },
];
const PEND_COL_DEFAULT = ["order", "client", "phone", "address", "door", "qty", "installer"];
const PEND_COLS_KEY = "indigo:install-pending-cols";

const COLOR_DOT: Record<string, string> = {
  white: "#fff",
  bronze: "#a16207",
  bronze_eco: "#854d0e",
  black: "#111",
  custom: "#a78bfa",
};

export default function InstallationsPage() {
  const [range, setRange] = useState(() => {
    const mon = startOfWeek(new Date());
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { from: ymd(mon), to: ymd(sun) };
  });
  const [q, setQ] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | number>("all");

  // Pending Scheduling — configurable columns (saved per user) + sort.
  const [pendColKeys, setPendColKeys] = useState<string[]>(PEND_COL_DEFAULT);
  const [pendSort, setPendSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "order",
    dir: "asc",
  });
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PEND_COLS_KEY);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length) {
          // Loading persisted column prefs on mount is a legitimate one-shot.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setPendColKeys(arr.filter((k: string) => PEND_COLUMNS.some((c) => c.key === k)));
        }
      }
    } catch {
      /* ignore */
    }
  }, []);
  function togglePendCol(key: string) {
    setPendColKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      const ordered = PEND_COLUMNS.filter((c) => next.includes(c.key)).map((c) => c.key);
      try {
        localStorage.setItem(PEND_COLS_KEY, JSON.stringify(ordered));
      } catch {
        /* ignore */
      }
      return ordered;
    });
  }
  function sortPend(key: string) {
    setPendSort((p) => (p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }
  const visiblePendCols = PEND_COLUMNS.filter((c) => pendColKeys.includes(c.key));
  const [addInstallerOpen, setAddInstallerOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // Bulk selection of orders (to mark several as Installed / send to a stage).
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [marking, setMarking] = useState(false);
  const stagesQ = useQuery<{ records: Array<{ id: number; name: string; code: string; sequence: number }> }>({
    queryKey: ["stages-list"],
    queryFn: () => fetch("/api/stages").then((r) => r.json()),
    staleTime: 10 * 60_000,
  });
  function toggleSel(id: number) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selectMany(ids: number[], on: boolean) {
    setSelected((p) => {
      const n = new Set(p);
      ids.forEach((i) => (on ? n.add(i) : n.delete(i)));
      return n;
    });
  }
  function clearSel() {
    setSelected(new Set());
  }
  function refreshDash() {
    qc.invalidateQueries({ queryKey: ["installers-dashboard"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }

  // Mark the selected orders as Installed (the "terminado" bulk action).
  async function markInstalled() {
    if (marking) return;
    const ids = Array.from(selected);
    if (!ids.length) return;
    const installed = stagesQ.data?.records?.find((s) => s.code === "installed");
    if (!installed) {
      toast.error("Stage 'Installed' not found. Reload and try again.");
      return;
    }
    if (!confirm(`Mark ${ids.length} order${ids.length === 1 ? "" : "s"} as Installed (terminado)?`)) return;
    setMarking(true);
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/orders/${id}/stage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage_id: installed.id,
            note: "Marked installed (bulk)",
            source: `Mark installed (${ids.length})`,
          }),
        }).then(async (r) => {
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
          return j;
        }),
      ),
    );
    setMarking(false);
    const failed = results.filter((r) => r.status === "rejected").length;
    refreshDash();
    clearSel();
    if (failed === 0) toast.success(`${ids.length} marked as Installed`);
    else if (failed === ids.length) toast.error(`All ${ids.length} updates failed.`);
    else toast.warning(`${ids.length - failed} of ${ids.length} marked. ${failed} failed.`);
  }

  const { data, isLoading, isError, refetch } = useQuery<DashboardData>({
    queryKey: ["installers-dashboard", range.from, range.to],
    queryFn: () =>
      fetchJson<DashboardData>(
        `/api/installers/dashboard?from=${range.from}&to=${range.to}`,
      ),
  });

  const filteredInstallers = useMemo(() => {
    if (!data) return [];
    const base = activeTab === "all"
      ? data.installers
      : data.installers.filter((i) => i.id === activeTab);
    if (!q.trim()) return base;
    const needle = q.toLowerCase();
    return base
      .map((i) => ({
        ...i,
        orders: i.orders.filter(
          (o) =>
            o.client_name.toLowerCase().includes(needle) ||
            o.name.toLowerCase().includes(needle) ||
            o.dealer_ref.toLowerCase().includes(needle) ||
            o.client_address.toLowerCase().includes(needle),
        ),
      }))
      .filter((i) => i.orders.length > 0);
  }, [data, activeTab, q]);

  // Pending installs that have no date yet — week-agnostic, so they show
  // regardless of which week is selected. This is what the dashboard
  // "Installations Pending" KPI counts that the weekly view used to hide.
  const unscheduled = useMemo(() => {
    const rows = data?.unscheduled ?? [];
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter(
      (o) =>
        o.client_name.toLowerCase().includes(needle) ||
        o.name.toLowerCase().includes(needle) ||
        o.dealer_ref.toLowerCase().includes(needle) ||
        o.client_address.toLowerCase().includes(needle),
    );
  }, [data, q]);

  // Pending rows sorted by the active column/direction.
  const sortedPending = useMemo(() => {
    const col = PEND_COLUMNS.find((c) => c.key === pendSort.key);
    if (!col) return unscheduled;
    const dir = pendSort.dir === "asc" ? 1 : -1;
    return [...unscheduled].sort((a, b) => {
      const va = col.sortVal(a);
      const vb = col.sortVal(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [unscheduled, pendSort]);

  // Overdue: scheduled in the past, still not installed. Week-agnostic.
  const overdue = useMemo(() => {
    const rows = data?.overdue ?? [];
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter(
      (o) =>
        o.client_name.toLowerCase().includes(needle) ||
        o.name.toLowerCase().includes(needle) ||
        o.dealer_ref.toLowerCase().includes(needle) ||
        o.client_address.toLowerCase().includes(needle),
    );
  }, [data, q]);

  // Days in the current range (for the prev/next period stepping).
  const rangeDays = useMemo(() => {
    const a = new Date(range.from + "T00:00:00").getTime();
    const b = new Date(range.to + "T00:00:00").getTime();
    return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
  }, [range]);

  // Shift the whole range by N days (previous / next period).
  function shiftRange(deltaDays: number) {
    setRange((r) => {
      const f = new Date(r.from + "T00:00:00");
      f.setDate(f.getDate() + deltaDays);
      const t = new Date(r.to + "T00:00:00");
      t.setDate(t.getDate() + deltaDays);
      return { from: ymd(f), to: ymd(t) };
    });
  }

  // Quick presets.
  function setThisWeek() {
    const mon = startOfWeek(new Date());
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    setRange({ from: ymd(mon), to: ymd(sun) });
  }
  function setNextWeek() {
    const mon = startOfWeek(new Date());
    mon.setDate(mon.getDate() + 7);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    setRange({ from: ymd(mon), to: ymd(sun) });
  }
  function setThisMonth() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setRange({ from: ymd(first), to: ymd(last) });
  }

  // Export what the user currently sees (respects the search + installer tab)
  // as a flat CSV — one row per scheduled door.
  function exportCsv() {
    const rows = filteredInstallers.flatMap((inst) =>
      inst.orders.map((o) => ({ installer: inst.name, o })),
    );
    if (!rows.length) {
      toast.warning("Nothing to export for this view.");
      return;
    }
    const csv = toCsv(rows, [
      { header: "Installer", value: (r) => r.installer },
      { header: "Order #", value: (r) => r.o.dealer_ref || r.o.name },
      { header: "Client", value: (r) => r.o.client_name },
      { header: "Address", value: (r) => r.o.client_address?.replace(/\n/g, " ") },
      { header: "Door Type", value: (r) => DOOR_TYPE_LABEL[r.o.door_type] ?? r.o.door_type },
      { header: "Color", value: (r) => r.o.color },
      { header: "Qty", value: (r) => r.o.qty },
      { header: "Status", value: (r) => r.o.status },
      { header: "Scheduled", value: (r) => (r.o.scheduled_date ? String(r.o.scheduled_date) : "") },
    ]);
    downloadCsv(`installations-${range.from}_${range.to}.csv`, csv);
    toast.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  }

  // Print the Pending Scheduling worklist (respects the search) as a sheet to
  // call clients and plan dates on paper. Includes phone + a blank "Scheduled
  // date" column to write the agreed date in.
  function printPending() {
    const rows = sortedPending;
    if (!rows.length) {
      toast.warning("Nothing to print in Pending Scheduling.");
      return;
    }
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Allow pop-ups to print the list");
      return;
    }
    const esc = (v: unknown) =>
      String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
    // Print follows the columns chosen on screen, + a blank "Scheduled date".
    const cols = visiblePendCols;
    const head =
      `<th>#</th>` +
      cols.map((c) => `<th${c.thClass ? ' class="r"' : ""}>${esc(c.label)}</th>`).join("") +
      `<th>Scheduled date</th>`;
    const body = rows
      .map(
        (o, i) =>
          `<tr><td>${i + 1}</td>` +
          cols.map((c) => `<td${c.thClass ? ' class="r"' : ""}>${esc(c.print(o))}</td>`).join("") +
          `<td class="sd"></td></tr>`,
      )
      .join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>Installations — Pending Scheduling</title>
      <style>
        body{margin:22px;color:#111;font-family:Arial,Helvetica,sans-serif;}
        h1{font-size:17px;margin:0 0 2px;color:#1f4486;}
        .sub{font-size:11px;color:#555;margin-bottom:12px;}
        table{width:100%;border-collapse:collapse;font-size:10px;}
        th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top;}
        th{background:#1f4486;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        td.r,th.r{text-align:right;white-space:nowrap;}
        td.nw{white-space:nowrap;}
        td.sd{width:90px;}
        thead{display:table-header-group;}
        tr{page-break-inside:avoid;}
        @page{size:landscape;margin:12mm;}
      </style></head><body>
      <h1>Indigo Decors — Pending Scheduling</h1>
      <div class="sub">${rows.length} order${rows.length === 1 ? "" : "s"} to schedule${q ? ` · filter “${esc(q)}”` : ""} · ${esc(new Date().toLocaleString())}</div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      <script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>
      </body></html>`);
    w.document.close();
  }

  const summary = data?.summary;

  // Donut data
  const donutData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: "Installed", value: summary.installedThisWeek, fill: "#10b981" },
      { name: "Pending", value: summary.pendingThisWeek, fill: "#f59e0b" },
    ];
  }, [summary]);

  if (isError) {
    return (
      <div className="mx-auto max-w-[1700px]">
        <ErrorState
          title="Couldn't load installations"
          message="The installations board failed to load. Check your connection and try again."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1700px] space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Installations
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage doors assigned to installers and track installation progress.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72">
            <Search
              size={16}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            />
            <Input
              placeholder="Search by order, client or reference..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-10 pl-10"
            />
          </div>
          <Button variant="outline" size="lg" onClick={printPending}>
            <Printer size={14} /> Print list
          </Button>
          <Button variant="outline" size="lg" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </Button>
          <Button size="lg" onClick={() => setAddInstallerOpen(true)}>
            <Plus size={14} /> Add Installer
          </Button>
        </div>
      </header>

      {/* Date-range control — the whole board reflects installations whose
          scheduled date falls inside this range (e.g. Mon 7 → Sat 12). */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Calendar size={15} className="text-indigo-700" />
          Showing installations
        </span>
        <input
          type="date"
          value={range.from}
          max={range.to}
          onChange={(e) =>
            e.target.value && setRange((r) => ({ ...r, from: e.target.value }))
          }
          aria-label="From date"
          className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
        />
        <span className="text-slate-400">to</span>
        <input
          type="date"
          value={range.to}
          min={range.from}
          onChange={(e) =>
            e.target.value && setRange((r) => ({ ...r, to: e.target.value }))
          }
          aria-label="To date"
          className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
        />
        <div className="ml-1 flex items-center gap-1">
          <RangePreset onClick={setThisWeek}>This week</RangePreset>
          <RangePreset onClick={setNextWeek}>Next week</RangePreset>
          <RangePreset onClick={setThisMonth}>This month</RangePreset>
        </div>
        <div className="ml-auto flex items-center gap-1 text-xs text-slate-600">
          <button
            type="button"
            onClick={() => shiftRange(-rangeDays)}
            className="rounded p-1 hover:bg-slate-100"
            aria-label="Previous period"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[130px] text-center font-medium">
            {formatRange(range.from, range.to)}
          </span>
          <button
            type="button"
            onClick={() => shiftRange(rangeDays)}
            className="rounded p-1 hover:bg-slate-100"
            aria-label="Next period"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <AddInstallerModal
        open={addInstallerOpen}
        onClose={() => setAddInstallerOpen(false)}
      />

      <ScheduleInstallationModal
        target={scheduleTarget}
        onClose={() => setScheduleTarget(null)}
      />

      {/* Bulk action bar — appears when orders are selected. Mark several as
          Installed ("terminado") at once, or send them to another stage. */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 shadow-sm">
          <Badge variant="secondary" className="bg-indigo-100 text-xs font-bold uppercase tracking-wide text-indigo-700">
            {selected.size} selected
            <button
              type="button"
              onClick={clearSel}
              aria-label="Clear selection"
              className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-indigo-200"
            >
              <X size={10} />
            </button>
          </Badge>
          <Button
            size="sm"
            onClick={markInstalled}
            disabled={marking}
            className="bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700 disabled:opacity-60"
          >
            <CheckSquare size={13} />
            {marking ? "Marking…" : "Mark as Installed"}
          </Button>
          <BulkSendToButton
            orderIds={Array.from(selected)}
            stages={stagesQ.data?.records ?? []}
            onSuccess={() => {
              clearSel();
              refreshDash();
            }}
          />
          <button
            type="button"
            onClick={clearSel}
            className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            Clear
          </button>
        </div>
      )}

      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiTile
          label="Total Installers"
          value={fmtNum(summary?.totalInstallers ?? 0)}
          hint="Active"
          icon={Users}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-700"
        />
        <KpiTile
          label="Scheduled"
          value={fmtNum(summary?.scheduled ?? 0)}
          hint="On calendar"
          icon={Calendar}
          iconBg="bg-sky-50"
          iconColor="text-sky-600"
        />
        <KpiTile
          label="Doors to Install"
          value={fmtNum(summary?.doorsToInstall ?? 0)}
          hint="In range"
          icon={FolderOpen}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
        />
        <KpiTile
          label="Installed"
          value={fmtNum(summary?.installedThisWeek ?? 0)}
          hint="In range"
          icon={CheckSquare}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
        />
        <KpiTile
          label="Pending Installation"
          value={fmtNum(summary?.pendingThisWeek ?? 0)}
          hint="Remaining"
          icon={PieIcon}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
        />
      </section>

      {/* Overdue — scheduled in the past but still not installed. Highest
          priority: these slip through both the weekly view (past week) and
          the Pending Scheduling panel (they have a date). */}
      {overdue.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-rose-200 bg-rose-50/50 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 px-5 py-3">
            <h3 className="flex items-center gap-1.5 font-semibold text-rose-900">
              <AlertTriangle size={15} className="text-rose-600" />
              Overdue Installations
              <Badge
                variant="secondary"
                className="bg-rose-200 text-[10px] font-bold text-rose-800"
              >
                {overdue.length}
              </Badge>
            </h3>
            <span className="text-xs text-rose-700">
              Scheduled date has passed and not marked installed. Reschedule or
              open the order to close it out.
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-rose-100/60 text-left text-[10px] font-bold uppercase tracking-wide text-rose-800">
                <tr>
                  <th className="px-3 py-2.5 w-8">
                    <Checkbox
                      checked={overdue.length > 0 && overdue.every((o) => selected.has(o.id))}
                      onCheckedChange={(v) => selectMany(overdue.map((o) => o.id), !!v)}
                      aria-label="Select all overdue"
                    />
                  </th>
                  <th className="px-4 py-2.5">Order Number</th>
                  <th className="px-4 py-2.5">Client Name</th>
                  <th className="px-4 py-2.5">Address</th>
                  <th className="px-4 py-2.5">Scheduled</th>
                  <th className="px-4 py-2.5 text-right">Qty</th>
                  <th className="px-4 py-2.5">Installer</th>
                  <th className="px-4 py-2.5 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((o) => (
                  <tr
                    key={o.id}
                    className={cn(
                      "border-t border-rose-100 transition hover:bg-rose-100/40",
                      selected.has(o.id) && "bg-rose-100/60",
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <Checkbox
                        checked={selected.has(o.id)}
                        onCheckedChange={() => toggleSel(o.id)}
                        aria-label={`Select ${o.dealer_ref || o.name}`}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/orders/${o.id}`}
                        className="font-mono text-xs font-semibold text-indigo-700 hover:underline"
                        title={o.name}
                      >
                        {o.dealer_ref || o.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{o.client_name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {o.client_address || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className="text-slate-600">
                        {fmtYmd(o.scheduled_date)}
                      </span>
                      <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                        {o.days_overdue}d late
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {o.qty}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {o.installer === "Unassigned" ? (
                        <span className="text-rose-700">Unassigned</span>
                      ) : (
                        o.installer
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setScheduleTarget({
                            id: o.id,
                            label: o.dealer_ref || o.name,
                            clientName: o.client_name,
                            installerIds: o.installer_ids,
                            scheduled: true,
                            date: o.scheduled_date,
                          })
                        }
                        className="inline-flex h-7 items-center justify-center gap-1 rounded-lg bg-rose-600 px-2.5 text-[11px] font-semibold text-white transition hover:bg-rose-700"
                      >
                        <Calendar size={11} /> Reschedule
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pending scheduling — orders awaiting an installation date. These are
          counted in the dashboard "Installations Pending" KPI but have no
          date, so they don't appear in any week. Surface them here so they
          can be opened and scheduled. */}
      {unscheduled.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/50 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 px-5 py-3">
            <h3 className="flex items-center gap-1.5 font-semibold text-amber-900">
              <Calendar size={15} className="text-amber-600" />
              Pending Scheduling
              <Badge
                variant="secondary"
                className="bg-amber-200 text-[10px] font-bold text-amber-800"
              >
                {unscheduled.length}
              </Badge>
            </h3>
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-amber-700 sm:inline">
                Ready to install — no date yet.
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-800 transition hover:bg-amber-50 focus-visible:outline-none">
                  <Columns3 size={13} /> Columns
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Columns
                    </DropdownMenuLabel>
                    {PEND_COLUMNS.map((c) => (
                      <DropdownMenuCheckboxItem
                        key={c.key}
                        checked={pendColKeys.includes(c.key)}
                        closeOnClick={false}
                        onCheckedChange={() => togglePendCol(c.key)}
                      >
                        {c.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-amber-100/60 text-left text-[10px] font-bold uppercase tracking-wide text-amber-800">
                <tr>
                  <th className="px-3 py-2.5 w-8">
                    <Checkbox
                      checked={sortedPending.length > 0 && sortedPending.every((o) => selected.has(o.id))}
                      onCheckedChange={(v) => selectMany(sortedPending.map((o) => o.id), !!v)}
                      aria-label="Select all pending"
                    />
                  </th>
                  {visiblePendCols.map((c) => (
                    <th key={c.key} className={`px-4 py-2.5 ${c.thClass ?? ""}`}>
                      <button
                        type="button"
                        onClick={() => sortPend(c.key)}
                        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-amber-900"
                      >
                        {c.label}
                        {pendSort.key === c.key && (
                          <span>{pendSort.dir === "asc" ? "▲" : "▼"}</span>
                        )}
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {sortedPending.map((o) => (
                  <tr
                    key={o.id}
                    className={cn(
                      "border-t border-amber-100 transition hover:bg-amber-100/40",
                      selected.has(o.id) && "bg-amber-100/70",
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <Checkbox
                        checked={selected.has(o.id)}
                        onCheckedChange={() => toggleSel(o.id)}
                        aria-label={`Select ${o.dealer_ref || o.name}`}
                      />
                    </td>
                    {visiblePendCols.map((c) => (
                      <td key={c.key} className={`px-4 py-2.5 ${c.thClass ?? ""}`}>
                        {c.cell(o)}
                      </td>
                    ))}
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setScheduleTarget({
                            id: o.id,
                            label: o.dealer_ref || o.name,
                            clientName: o.client_name,
                            installerIds: o.installer_ids,
                          })
                        }
                        className="inline-flex h-7 items-center justify-center gap-1 rounded-lg bg-amber-600 px-2.5 text-[11px] font-semibold text-white transition hover:bg-amber-700"
                      >
                        <Calendar size={11} /> Schedule
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Body */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* LEFT — installer assignments */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <h3 className="flex items-center gap-1.5 font-semibold text-slate-800">
              Installers and Assignments
              <Info size={13} className="text-slate-400" />
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                <Calendar size={12} className="text-slate-400" />
                {data ? formatRange(data.rangeStart, data.rangeEnd) : "—"}
              </div>
            </div>
          </div>

          {/* Tabs row */}
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 pt-2 text-xs">
            <TabChip
              label="All Installers"
              count={data?.installers.length ?? 0}
              active={activeTab === "all"}
              onClick={() => setActiveTab("all")}
            />
            {data?.installers.map((i) => (
              <TabChip
                key={i.id}
                label={shortName(i.name)}
                count={i.doors}
                active={activeTab === i.id}
                onClick={() => setActiveTab(i.id)}
              />
            ))}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Order Number</th>
                  <th className="px-4 py-3">Client Name</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3">Door Type</th>
                  <th className="px-4 py-3">Color</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Scheduled Date</th>
                  <th className="px-4 py-3 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={9} className="p-12 text-center text-xs text-slate-400">
                      Loading…
                    </td>
                  </tr>
                )}
                {!isLoading && filteredInstallers.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-12 text-center text-xs text-slate-400">
                      No installer assignments in this range.
                    </td>
                  </tr>
                )}
                {filteredInstallers.map((inst) => {
                  const open = !collapsed.has(inst.id);
                  return (
                    <FragmentRows key={inst.id}>
                      <tr className="bg-slate-50/60 border-t border-slate-100">
                        <td colSpan={9} className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsed((prev) => {
                                const next = new Set(prev);
                                if (next.has(inst.id)) next.delete(inst.id);
                                else next.add(inst.id);
                                return next;
                              })
                            }
                            className="flex w-full items-center justify-between text-left"
                          >
                            <div className="flex items-center gap-2">
                              <ChevronDown
                                size={14}
                                className={cn(
                                  "text-slate-500 transition",
                                  !open && "-rotate-90",
                                )}
                              />
                              <Users size={14} className="text-indigo-700" />
                              <span className="font-semibold text-slate-800">
                                {inst.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <span>
                                <strong className="text-slate-700">{inst.doors}</strong>{" "}
                                Doors
                              </span>
                              <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
                                {inst.installed} Installed
                              </span>
                              <span className="rounded-md bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">
                                {inst.pending} Pending
                              </span>
                            </div>
                          </button>
                        </td>
                      </tr>
                      {open &&
                        inst.orders.map((o) => (
                          <tr
                            key={`${inst.id}-${o.id}`}
                            className="border-t border-slate-100 transition hover:bg-slate-50"
                          >
                            <td className="px-4 py-2.5">
                              <Link
                                href={`/orders/${o.id}`}
                                className="font-mono text-xs font-semibold text-indigo-700 hover:underline"
                                title={o.name}
                              >
                                {o.dealer_ref || o.name}
                              </Link>
                            </td>
                            <td className="px-4 py-2.5 text-slate-700">
                              {o.client_name}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600">
                              {o.client_address}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-700">
                              {DOOR_TYPE_LABEL[o.door_type] ?? o.door_type ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 capitalize">
                              <span className="flex items-center gap-1.5 text-xs">
                                <span
                                  className="inline-block h-2.5 w-2.5 rounded-full border border-slate-300"
                                  style={{
                                    background:
                                      COLOR_DOT[o.color] ?? "#cbd5e1",
                                  }}
                                />
                                {o.color?.replace("_", " ") || "—"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs font-mono">
                              {o.qty}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusPill status={o.status} />
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600">
                              {fmtDate(o.scheduled_date as string)}
                            </td>
                            <td className="px-4 py-2.5">
                              {o.status === "scheduled" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setScheduleTarget({
                                      id: o.id,
                                      label: o.dealer_ref || o.name,
                                      clientName: o.client_name,
                                      installerIds: [inst.id],
                                      scheduled: true,
                                      date: (o.scheduled_date as string) || undefined,
                                    })
                                  }
                                  className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50"
                                >
                                  <Calendar size={11} /> Reschedule
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </FragmentRows>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
            Showing 1 to {filteredInstallers.length} of{" "}
            {data?.installers.length ?? 0} installers
          </div>
        </div>

        {/* RIGHT — widgets */}
        <div className="space-y-4 lg:col-span-4">
          {/* Installer Overview Donut */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h3 className="mb-3 font-semibold text-slate-800">
              Installer Overview
            </h3>
            <div className="flex items-center gap-3">
              <div className="relative h-36 w-36 flex-none">
                <ResponsiveContainer>
                  <RPieChart>
                    <Pie
                      data={donutData}
                      innerRadius={42}
                      outerRadius={62}
                      dataKey="value"
                      paddingAngle={2}
                    >
                      {donutData.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Pie>
                  </RPieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-slate-900">
                    {summary?.doorsToInstall ?? 0}
                  </span>
                  <span className="text-[10px] text-slate-500">Total Doors</span>
                </div>
              </div>
              <ul className="flex-1 space-y-1.5 text-xs">
                {donutData.map((d) => {
                  const total = summary?.doorsToInstall || 1;
                  const pct = ((d.value / total) * 100).toFixed(1);
                  return (
                    <li key={d.name} className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: d.fill }}
                      />
                      <span className="text-slate-600">{d.name}</span>
                      <span className="ml-auto font-semibold text-slate-800">
                        {d.value}
                      </span>
                      <span className="text-slate-400">({pct}%)</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* Weekly Installation Summary */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h3 className="mb-2 font-semibold text-slate-800">
              Installation Summary
            </h3>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
              <button
                type="button"
                onClick={() => shiftRange(-rangeDays)}
                className="rounded p-1 hover:bg-slate-100"
                aria-label="Previous period"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="font-medium">
                {data ? formatRange(data.rangeStart, data.rangeEnd) : "—"}
              </span>
              <button
                type="button"
                onClick={() => shiftRange(rangeDays)}
                className="rounded p-1 hover:bg-slate-100"
                aria-label="Next period"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="h-44">
              <ResponsiveContainer>
                <BarChart data={data?.days ?? []} barCategoryGap={6}>
                  <XAxis
                    dataKey="label"
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      fontSize: 11,
                    }}
                  />
                  <Bar
                    dataKey="installed"
                    stackId="a"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="pending"
                    stackId="a"
                    fill="#f59e0b"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="not_scheduled"
                    stackId="a"
                    fill="#cbd5e1"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Installed
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Pending
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-slate-300" /> Not Scheduled
              </span>
            </div>
          </div>

          {/* Payment Summary */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h3 className="mb-3 font-semibold text-slate-800">
              Payment Summary (in range)
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between text-slate-600">
                <dt className="flex items-center gap-1.5">
                  <CheckSquare size={12} className="text-slate-400" />
                  Installations Completed
                </dt>
                <dd className="font-semibold text-slate-900">
                  {summary?.installedThisWeek ?? 0} Doors
                </dd>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <dt className="flex items-center gap-1.5">
                  <CircleDollarSign size={12} className="text-slate-400" />
                  Payment per Door
                </dt>
                <dd className="font-semibold text-slate-900">
                  ${data?.ratePerDoor.toFixed(2) ?? "0.00"}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
                <dt className="font-bold">Total Payment Due</dt>
                <dd className="font-bold">
                  {fmtMoney(summary?.paymentDue ?? 0)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 flex items-center gap-1 text-[10px] text-slate-400">
              <Info size={9} />
              Payments are calculated based on completed installations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function TabChip({
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
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition",
        active
          ? "border-b-2 border-indigo-700 text-indigo-700"
          : "text-slate-500 hover:text-slate-700",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-[10px] font-bold",
          active ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function RangePreset({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: "installed" | "scheduled" | "pending" }) {
  const map = {
    installed: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Installed" },
    scheduled: { bg: "bg-sky-50", text: "text-sky-700", label: "Scheduled" },
    pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pending" },
  };
  const cfg = map[status];
  return (
    <Badge
      variant="secondary"
      className={cn("text-[10px] font-bold uppercase tracking-wide", cfg.bg, cfg.text)}
    >
      {cfg.label}
    </Badge>
  );
}

function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  iconBg,
  iconColor,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-12 w-12 flex-none items-center justify-center rounded-xl",
            iconBg,
          )}
        >
          <Icon size={20} className={iconColor} />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="mt-0.5 text-2xl font-bold leading-tight text-slate-900">
            {value}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">
            {hint}
          </div>
        </div>
      </div>
    </div>
  );
}

function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}
