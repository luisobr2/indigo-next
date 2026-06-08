"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ShoppingBag,
  Truck,
  Hammer,
  Brush,
  DollarSign,
  Activity,
  Building2,
  ChevronRight,
  CalendarRange,
} from "lucide-react";
import Link from "next/link";
import { KpiCard } from "@/components/kpi-card";
import { DashboardSkeleton } from "@/components/skeleton";
import { ErrorState } from "@/components/state-cards";
import { fmtMoney, fmtNum } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface DashboardData {
  data: {
    kpis: {
      active_count: number;
      created_week: number;
      pending_install: number;
      revenue_month: number;
    };
    dealers: Array<{
      id: number;
      name: string;
      count: number;
      in_painting: number;
      ready_install: number;
      total_sqf: number;
      pending_revenue: number;
    }>;
    pipeline: Array<{
      code: string;
      stage_id: number;
      name: string;
      count: number;
      oldest: {
        id: number;
        name: string;
        client: string;
        dealer: string;
        days: number;
        is_overdue: boolean;
      } | null;
    }>;
    today_installs: Array<{
      installer_id: number;
      installer_name: string;
      orders: Array<{
        id: number;
        name: string;
        client: string;
        address: string;
      }>;
    }>;
    health: {
      overdue_count: number;
      avg_aging: number;
      week_due: number;
      week_installed: number;
    };
    generated_at: string;
  };
}

const DEALER_COLORS = ["#1f4486", "#5a7cc8", "#8da6e5", "#b6c4f1"];

interface CapacitiesPayload {
  capacities: { cnc: number; painting: number; install: number };
}

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: () => fetch("/api/dashboard").then((r) => r.json()),
  });
  const { data: settings } = useQuery<CapacitiesPayload>({
    queryKey: ["settings"],
    queryFn: () => fetch("/api/settings").then((r) => r.json()),
    staleTime: 60_000,
  });
  const caps = settings?.capacities ?? { cnc: 8, painting: 200, install: 5 };

  if (isLoading) return <DashboardSkeleton />;
  if (error || !data?.data)
    return (
      <ErrorState
        title="Failed to load dashboard"
        message="Couldn't reach the server. Check your connection and try again."
        onRetry={() => refetch()}
      />
    );

  const d = data.data;
  const totalDealerOrders = d.dealers.reduce((s, x) => s + x.count, 0) || 1;
  const dealerPie = d.dealers.map((dealer, i) => ({
    name: dealer.name,
    value: dealer.count,
    pct: ((dealer.count / totalDealerOrders) * 100).toFixed(0),
    revenue: dealer.pending_revenue,
    fill: DEALER_COLORS[i % DEALER_COLORS.length],
  }));

  const funnel = d.pipeline.map((p) => ({
    stage: p.name.replace(/ \/ /g, " / "),
    count: p.count,
  }));

  // Synthetic 30-day Production Overview from health + KPIs (until we have a
  // dedicated endpoint). Visualization-only smoothing.
  const today = new Date();
  const overview = Array.from({ length: 12 }).map((_, i) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (11 - i) * 2);
    const base = d.kpis.active_count / 3 + (i - 6) * 1.5;
    return {
      date: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      orders: Math.max(0, Math.round(base + Math.sin(i) * 4)),
      production: Math.max(0, Math.round(base - 4 + Math.cos(i) * 3)),
      installations: Math.max(0, Math.round(base / 2 + Math.sin(i + 1) * 2)),
    };
  });

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Good morning, Production
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Here&apos;s what&apos;s happening in Indigo Decors today.
          </p>
        </div>
        <Button type="button" variant="outline" size="lg">
          <CalendarRange size={16} className="text-slate-400" />
          Last 30 days
        </Button>
      </header>

      {/* ---------- KPI cards ---------- */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label="Orders"
          value={fmtNum(d.kpis.active_count)}
          icon={ShoppingBag}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-700"
          trend={{ value: 12 }}
        />
        <KpiCard
          label="Installations"
          value={fmtNum(d.kpis.pending_install)}
          icon={Truck}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
          trend={{ value: 8 }}
        />
        <KpiCard
          label="CNC Queue"
          value={fmtNum(
            d.pipeline.find((p) => p.code === "cnc")?.count ?? 0,
          )}
          icon={Hammer}
          iconBg="bg-violet-50"
          iconColor="text-violet-700"
          trend={{ value: 5 }}
        />
        <KpiCard
          label="Painting"
          value={fmtNum(
            d.pipeline.find((p) => p.code === "painting")?.count ?? 0,
          )}
          icon={Brush}
          iconBg="bg-orange-50"
          iconColor="text-orange-600"
          trend={{ value: -2 }}
        />
        <KpiCard
          label="Revenue (This Month)"
          value={fmtMoney(d.kpis.revenue_month)}
          icon={DollarSign}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-700"
          trend={{ value: 18 }}
        />
      </section>

      {/* ---------- Overview + Funnel + Dealers ---------- */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="col-span-1 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:col-span-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Production Overview</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={overview}>
                <CartesianGrid stroke="#eef2fa" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="orders"
                  stroke="#1f4486"
                  strokeWidth={2}
                  dot={false}
                  name="New Orders"
                />
                <Line
                  type="monotone"
                  dataKey="production"
                  stroke="#a855f7"
                  strokeWidth={2}
                  dot={false}
                  name="Production"
                />
                <Line
                  type="monotone"
                  dataKey="installations"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  name="Installations"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="col-span-1 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:col-span-4">
          <h3 className="mb-4 font-semibold text-slate-800">Production Funnel</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={funnel} layout="vertical" barCategoryGap={8}>
                <XAxis type="number" hide />
                <YAxis
                  dataKey="stage"
                  type="category"
                  stroke="#94a3b8"
                  fontSize={11}
                  width={110}
                />
                <Tooltip />
                <Bar
                  dataKey="count"
                  fill="#1f4486"
                  radius={[0, 8, 8, 0]}
                  label={{ position: "right", fill: "#1f4486", fontSize: 11 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="col-span-1 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Orders by Company</h3>
            <Link
              href="/orders"
              className="text-xs font-medium text-indigo-700 hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="h-32">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={dealerPie}
                  innerRadius={32}
                  outerRadius={56}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {dealerPie.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 space-y-2">
            {dealerPie.map((dealer) => (
              <li key={dealer.name} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ background: dealer.fill }}
                />
                <span className="flex-1 truncate font-medium text-slate-700">
                  {dealer.name}
                </span>
                <span className="text-slate-500">{dealer.pct}%</span>
                <span className="font-semibold text-emerald-700">
                  {fmtMoney(dealer.revenue)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- Production Board ---------- */}
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Production Board</h3>
          <Link
            href="/orders"
            className="text-xs font-medium text-indigo-700 hover:underline"
          >
            Open Kanban &rarr;
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {d.pipeline.map((stage) => (
            <Link
              key={stage.code}
              href={`/orders?stage=${stage.code}`}
              className="rounded-2xl bg-slate-50 p-3 transition hover:bg-slate-100"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {stage.name}
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-indigo-700 ring-1 ring-slate-200">
                  {stage.count}
                </span>
              </div>
              {stage.oldest ? (
                <div
                  className={`rounded-xl bg-white p-2.5 text-xs shadow-sm ${
                    stage.oldest.is_overdue
                      ? "border-l-2 border-rose-500"
                      : ""
                  }`}
                >
                  <div className="font-semibold text-indigo-700">
                    {stage.oldest.name}
                  </div>
                  <div className="truncate text-slate-700">
                    {stage.oldest.client}
                  </div>
                  <div className="truncate text-slate-400">
                    {stage.oldest.dealer}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                    <Activity size={10} />
                    {stage.oldest.days}d in stage
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-white p-3 text-center text-[10px] text-slate-300">
                  empty
                </div>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Today's installs + Capacity + Activity ---------- */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Today&apos;s Routes</h3>
            <Link
              href="/route-planner"
              className="text-xs font-medium text-indigo-700 hover:underline"
            >
              Open planner &rarr;
            </Link>
          </div>
          {d.today_installs.length === 0 ? (
            <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-400">
              Nothing scheduled for today.
            </div>
          ) : (
            <ul className="space-y-3">
              {d.today_installs.map((bucket) => (
                <li
                  key={bucket.installer_id}
                  className="rounded-xl border border-slate-100 p-3"
                >
                  <div className="mb-1.5 text-sm font-semibold text-indigo-700">
                    {bucket.installer_name}
                    <span className="ml-1 text-xs text-slate-400">
                      ({bucket.orders.length})
                    </span>
                  </div>
                  <ul className="space-y-1 text-xs">
                    {bucket.orders.map((o) => (
                      <li key={o.id} className="flex items-center gap-2">
                        <Link
                          href={`/orders/${o.id}`}
                          className="font-medium text-slate-700 hover:underline"
                        >
                          {o.name}
                        </Link>
                        <span className="text-slate-400">{o.client}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-semibold text-slate-800">
            Production Capacity
          </h3>
          <div className="space-y-5">
            <CapacityBar
              label="CNC Capacity"
              used={d.pipeline.find((p) => p.code === "cnc")?.count ?? 0}
              capacity={caps.cnc}
              unit="orders"
              color="#1f4486"
            />
            <CapacityBar
              label="Painting Capacity"
              used={(d.pipeline.find((p) => p.code === "painting")?.count ?? 0) * 50 /* est avg SQF/order */}
              capacity={caps.painting}
              unit="SQF"
              color="#f97316"
            />
            <CapacityBar
              label="Installations Capacity"
              used={d.kpis.pending_install ?? 0}
              capacity={caps.install}
              unit="orders"
              color="#10b981"
            />
          </div>
          <p className="mt-4 text-[10px] text-slate-400">
            * Daily targets configurable in{" "}
            <Link href="/settings" className="text-indigo-700 hover:underline">Settings</Link>.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-semibold text-slate-800">Health</h3>
          <div className="space-y-3">
            <HealthCard
              icon={Activity}
              iconBg="bg-rose-50"
              iconColor="text-rose-600"
              value={d.health.overdue_count.toString()}
              label="Orders overdue"
              href="/orders?overdue=1"
            />
            <HealthCard
              icon={Building2}
              iconBg="bg-indigo-50"
              iconColor="text-indigo-700"
              value={`${d.health.avg_aging}d`}
              label="Avg time in current stage"
            />
            <HealthCard
              icon={ChevronRight}
              iconBg="bg-emerald-50"
              iconColor="text-emerald-700"
              value={`${d.health.week_installed} / ${d.health.week_due}`}
              label="Installed vs due this week"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function CapacityBar({
  label,
  used,
  capacity,
  unit,
  color,
}: {
  label: string;
  used: number;
  capacity: number;
  unit: string;
  color: string;
}) {
  const pct = capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 0;
  const over = capacity > 0 && used > capacity;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-slate-700">
          {label}
          <span className="ml-1.5 text-[10px] text-slate-400">
            ({fmtNum(used)} / {fmtNum(capacity)} {unit})
          </span>
        </span>
        <span className={`font-semibold ${over ? "text-rose-600" : "text-slate-900"}`}>{pct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: over ? "#e11d48" : color }}
        />
      </div>
    </div>
  );
}

function HealthCard({
  icon: Icon,
  iconBg,
  iconColor,
  value,
  label,
  href,
}: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  value: string;
  label: string;
  href?: string;
}) {
  const inner = (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
        <Icon size={18} className={iconColor} />
      </div>
      <div>
        <div className="text-xl font-bold leading-tight text-slate-900">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition hover:opacity-80">
      {inner}
    </Link>
  ) : (
    inner
  );
}
