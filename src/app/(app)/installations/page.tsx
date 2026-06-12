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
  Printer,
  Plus,
  Settings as Gear,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  MoreVertical,
  CircleDollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, fmtNum, fmtDate, cn } from "@/lib/utils";
import { AddInstallerModal } from "@/components/add-installer-modal";
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
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["installers-dashboard", week],
    queryFn: () =>
      fetch(`/api/installers/dashboard?week=${week}`).then((r) => r.json()),
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

  function shiftWeek(deltaDays: number) {
    const d = new Date(week);
    d.setDate(d.getDate() + deltaDays);
    setWeek(ymd(startOfWeek(d)));
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
          <Button
            size="lg"
            className="bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700"
          >
            <Download size={14} /> Export Excel
          </Button>
          <Button variant="outline" size="lg">
            <Printer size={14} /> Print / PDF
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
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  toast.info("Manage installers — coming soon.")
                }
              >
                <Gear size={12} /> Manage Installers
              </Button>
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                <Calendar size={12} className="text-slate-400" />
                This Week
                <ChevronDown size={12} className="text-slate-400" />
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
                  <th className="px-4 py-3 w-10"></th>
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
                      No installer assignments for this week.
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
                            <td className="px-4 py-2.5 text-slate-400">
                              <button
                                type="button"
                                className="rounded p-1 hover:bg-slate-100"
                              >
                                <MoreVertical size={14} />
                              </button>
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
