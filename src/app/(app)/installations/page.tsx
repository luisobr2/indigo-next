"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Users,
  FolderOpen,
  CheckSquare,
  PieChart as PieIcon,
  Search,
  Download,
  Plus,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  CircleDollarSign,
  AlertTriangle,
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
  Legend,
} from "recharts";

interface DashboardData {
  weekStart: string;
  weekEnd: string;
  ratePerDoor: number;
  summary: {
    totalInstallers: number;
    doorsToInstall: number;
    installedThisWeek: number;
    pendingThisWeek: number;
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

function formatWeek(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString(
    "en-US",
    { ...opts, year: "numeric" },
  )}`;
}

const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "Single Door",
  DD: "Double Door",
  SDL: "Door with Sidelites",
};

const COLOR_DOT: Record<string, string> = {
  white: "#fff",
  bronze: "#a16207",
  bronze_eco: "#854d0e",
  black: "#111",
};

export default function InstallationsPage() {
  const [week, setWeek] = useState(() => ymd(startOfWeek(new Date())));
  const [q, setQ] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | number>("all");
  const [addInstallerOpen, setAddInstallerOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const { data, isLoading, isError, refetch } = useQuery<DashboardData>({
    queryKey: ["installers-dashboard", week],
    queryFn: () => fetchJson<DashboardData>(`/api/installers/dashboard?week=${week}`),
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

  function shiftWeek(deltaDays: number) {
    const d = new Date(week);
    d.setDate(d.getDate() + deltaDays);
    setWeek(ymd(startOfWeek(d)));
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
    downloadCsv(`installations-${week}.csv`, csv);
    toast.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  }

  const summary = data?.summary;

  // Donut data
  const donutData = useMemo(() => {
    if (!summary) return [];
    const ns = 0;
    return [
      { name: "Installed", value: summary.installedThisWeek, fill: "#10b981" },
      { name: "Pending", value: summary.pendingThisWeek, fill: "#f59e0b" },
      { name: "Not Started", value: ns, fill: "#cbd5e1" },
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
          <Button variant="outline" size="lg" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </Button>
          <Button size="lg" onClick={() => setAddInstallerOpen(true)}>
            <Plus size={14} /> Add Installer
          </Button>
        </div>
      </header>

      <AddInstallerModal
        open={addInstallerOpen}
        onClose={() => setAddInstallerOpen(false)}
      />

      <ScheduleInstallationModal
        target={scheduleTarget}
        onClose={() => setScheduleTarget(null)}
      />

      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Total Installers"
          value={fmtNum(summary?.totalInstallers ?? 0)}
          hint="Active"
          icon={Users}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-700"
        />
        <KpiTile
          label="Doors to Install"
          value={fmtNum(summary?.doorsToInstall ?? 0)}
          hint="This Week"
          icon={FolderOpen}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
        />
        <KpiTile
          label="Installed This Week"
          value={fmtNum(summary?.installedThisWeek ?? 0)}
          hint="Completed"
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
                    className="border-t border-rose-100 transition hover:bg-rose-100/40"
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
            <span className="text-xs text-amber-700">
              Ready to install — no date assigned yet. Open an order to schedule it.
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-amber-100/60 text-left text-[10px] font-bold uppercase tracking-wide text-amber-800">
                <tr>
                  <th className="px-4 py-2.5">Order Number</th>
                  <th className="px-4 py-2.5">Client Name</th>
                  <th className="px-4 py-2.5">Address</th>
                  <th className="px-4 py-2.5">Door Type</th>
                  <th className="px-4 py-2.5 text-right">Qty</th>
                  <th className="px-4 py-2.5">Installer</th>
                  <th className="px-4 py-2.5 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {unscheduled.map((o) => (
                  <tr
                    key={o.id}
                    className="border-t border-amber-100 transition hover:bg-amber-100/40"
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
                    <td className="px-4 py-2.5 text-slate-700">{o.client_name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {o.client_address || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-700">
                      {DOOR_TYPE_LABEL[o.door_type] ?? o.door_type ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {o.qty}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {o.installer === "Unassigned" ? (
                        <span className="text-amber-700">Unassigned</span>
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
                This Week
              </div>
            </div>
          </div>

          {/* Tabs row */}
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 pt-2 text-xs">
            <TabChip
              label="All Installers"
              count={data?.installers.reduce((s, i) => s + 1, 0) ?? 0}
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
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-xs text-slate-400">
                      Loading…
                    </td>
                  </tr>
                )}
                {!isLoading && filteredInstallers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-xs text-slate-400">
                      No installer assignments for this week.
                    </td>
                  </tr>
                )}
                {filteredInstallers.map((inst) => {
                  const open = !collapsed.has(inst.id);
                  return (
                    <FragmentRows key={inst.id}>
                      <tr className="bg-slate-50/60 border-t border-slate-100">
                        <td colSpan={8} className="px-4 py-2.5">
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
              Weekly Installation Summary
            </h3>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
              <button
                type="button"
                onClick={() => shiftWeek(-7)}
                className="rounded p-1 hover:bg-slate-100"
                aria-label="Previous week"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="font-medium">
                {data ? formatWeek(data.weekStart, data.weekEnd) : "—"}
              </span>
              <button
                type="button"
                onClick={() => shiftWeek(7)}
                className="rounded p-1 hover:bg-slate-100"
                aria-label="Next week"
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
              Payment Summary (This Week)
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
