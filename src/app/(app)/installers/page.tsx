"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  BadgeCheck,
  UserPlus,
  Download,
  DoorOpen,
  Info,
  Receipt,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { fmtMoney, fmtNum, cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { planSettle, costPerDoor } from "@/lib/installers/settle";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/state-cards";
import { Button } from "@/components/ui/button";
import {
  DateRangePicker,
  formatRange,
  weekOf,
  type DateRange,
} from "@/components/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type WorkMode = "per_door" | "daily" | "guarantee";

interface PayLine {
  kind: "work" | "minimum" | "bonus";
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

interface PayDay {
  key: string;
  date: string;
  status: "completed" | "scheduled";
  doors: number;
  installs: number;
  amount: number;
  workMode: WorkMode;
  payoutId: number | null;
  payoutName: string | null;
  payoutState: "draft" | "approved" | "paid" | "cancel" | null;
  orders: Array<{ id: number; name: string; client: string }>;
  notes: string[];
  incidents: number;
  lines: PayLine[];
}

interface Installer {
  installerId: number;
  name: string;
  rule: {
    ratePerDoor: number;
    dailyMinimum: number;
    bonusAmount: number;
    bonusUnit: "order" | "door";
    isOwn: boolean;
  } | null;
  days: PayDay[];
  doors: number;
  installs: number;
  total: number;
  pending: number;
  settled: number;
  scheduledAmount: number;
  daysAtMinimum: number;
  incidents: number;
}

interface Incident {
  id: number;
  date: string;
  order: string | null;
  orderId: number | null;
  client: string | null;
  reportedBy: string | null;
  category: string;
  description: string;
}

interface PayData {
  rangeStart: string;
  rangeEnd: string;
  truncated: boolean;
  lastActivityDate: string | null;
  rules: Array<{
    partnerId: number | null;
    partnerName: string | null;
    ratePerDoor: number;
    dailyMinimum: number;
    bonusAmount: number;
    bonusUnit: "order" | "door";
  }>;
  summary: {
    installers: number;
    daysWorked: number;
    daysScheduled: number;
    doors: number;
    doorsInstalled: number;
    total: number;
    pending: number;
    settled: number;
    scheduledAmount: number;
    daysAtMinimum: number;
    incidents: number;
    byMode: Record<WorkMode, number>;
  };
  installers: Installer[];
  incidents: Incident[];
}

const MODE_LABEL: Record<WorkMode, string> = {
  per_door: "Per Door",
  daily: "Daily Rate",
  guarantee: "Daily Rate (Min. Guarantee)",
};

const MODE_BADGE: Record<WorkMode, string> = {
  per_door: "bg-emerald-50 text-emerald-700",
  daily: "bg-amber-50 text-amber-700",
  guarantee: "bg-violet-50 text-violet-700",
};

const MODE_DOT: Record<WorkMode, string> = {
  per_door: "bg-emerald-500",
  daily: "bg-amber-500",
  guarantee: "bg-violet-500",
};

/** Built from the parts — `new Date("2026-08-17")` parses as UTC and shows
 *  the day before for anyone west of Greenwich, which is everyone here. */
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayLabel(s: string): string {
  return parseYmd(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    weekday: "short",
  });
}

/** How this person is paid, in one sentence, from their configured rule. */
function ruleSentence(rule: Installer["rule"]): string {
  if (!rule) return "No payment rule configured.";
  const bits: string[] = [];
  if (rule.ratePerDoor > 0) bits.push(`${fmtMoney(rule.ratePerDoor)}/door`);
  if (rule.dailyMinimum > 0) {
    bits.push(rule.ratePerDoor > 0 ? `min ${fmtMoney(rule.dailyMinimum)}/day` : `${fmtMoney(rule.dailyMinimum)}/day`);
  }
  if (rule.bonusAmount > 0) bits.push(`+${fmtMoney(rule.bonusAmount)}/${rule.bonusUnit === "door" ? "door" : "install"}`);
  return bits.join(" · ") || "No rate configured.";
}

export default function InstallersPage() {
  const [range, setRange] = useState<DateRange>(() => weekOf(new Date()));
  const { from, to } = range;

  const [who, setWho] = useState("all");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [settling, setSettling] = useState<Installer | null>(null);
  const [assigning, setAssigning] = useState<{ day: PayDay } | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  // Solo se pide cuando hace falta elegir a alguien.
  const { data: people } = useQuery<{ installers: Array<{ id: number; name: string }> }>({
    queryKey: ["contractors"],
    queryFn: () => fetchJson("/api/contractors"),
    enabled: assigning !== null,
  });

  const { data, isLoading, error, refetch } = useQuery<PayData>({
    queryKey: ["installer-pay", from, to],
    queryFn: () => fetchJson(`/api/installers/pay?from=${from}&to=${to}`),
  });

  const shown = useMemo(() => {
    if (!data) return [];
    return data.installers
      .filter((i) => who === "all" || String(i.installerId) === who)
      .map((i) => ({
        ...i,
        days: i.days.filter((d) => status === "all" || d.status === status),
      }))
      .filter((i) => i.days.length > 0);
  }, [data, who, status]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // El workbook se arma en el servidor desde el MISMO buildPayData que lee
  // la pantalla, asi que un total exportado no puede discrepar del que se ve.
  const exportHref = `/api/installers/pay/export?from=${from}&to=${to}`;

  async function confirmSettle() {
    if (!settling) return;
    const plan = planSettle(settling);
    setBusy(true);
    try {
      const r = await fetch("/api/billing/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "mark-paid", payoutIds: plan.payoutIds }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `Request failed (${r.status})`);
      toast.success(`${settling.name}: ${plan.days} day${plan.days === 1 ? "" : "s"} marked paid`);
      setSettling(null);
      qc.invalidateQueries({ queryKey: ["installer-pay"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't mark it paid");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAssign(installerId: number) {
    if (!assigning) return;
    setBusy(true);
    try {
      // Una orden por llamada: si una falla, se sabe cual.
      const results = await Promise.allSettled(
        assigning.day.orders.map((o) =>
          fetch(`/api/orders/${o.id}/assign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ installer_ids: [installerId] }),
          }).then(async (r) => {
            if (!r.ok) throw new Error(`${o.name}: ${r.status}`);
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed) {
        toast.warning(`${assigning.day.orders.length - failed} of ${assigning.day.orders.length} assigned.`);
      } else {
        toast.success(`Assigned ${assigning.day.orders.length} order${assigning.day.orders.length === 1 ? "" : "s"}`);
      }
      setAssigning(null);
      qc.invalidateQueries({ queryKey: ["installer-pay"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't assign");
    } finally {
      setBusy(false);
    }
  }

  const s = data?.summary;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Installers</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Daily activity and payments, by the day each installer worked.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} maxDays={92} />
          <a
            href={exportHref}
            download
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <Download size={14} aria-hidden />
            Export Excel
          </a>
        </div>
      </header>

      {error ? (
        <ErrorState message="Couldn't load installer pay." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          Loading…
        </div>
      ) : !data ? null : (
        <>
          {data.truncated && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                This range hit the server limit, so the totals below are
                incomplete. Narrow the dates to get exact figures.
              </span>
            </div>
          )}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={Users} tone="text-indigo-600" bg="bg-indigo-50" label="Installers" value={fmtNum(s!.installers)} hint="Worked this week" />
            <Kpi icon={DoorOpen} tone="text-emerald-600" bg="bg-emerald-50" label="Doors installed" value={fmtNum(s!.doorsInstalled)} hint={`${fmtNum(s!.daysWorked)} day${s!.daysWorked === 1 ? "" : "s"} worked`} />
            <Kpi
              icon={ShieldCheck}
              tone="text-violet-600"
              bg="bg-violet-50"
              label="Days at the minimum"
              value={`${s!.daysAtMinimum} of ${s!.daysWorked}`}
              hint="Doors didn't reach the floor"
            />
            <Kpi
              icon={AlertTriangle}
              tone={s!.incidents ? "text-rose-600" : "text-slate-400"}
              bg={s!.incidents ? "bg-rose-50" : "bg-slate-50"}
              label="Incidents reported"
              value={fmtNum(s!.incidents)}
              hint="This week"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            {/* ---------------- Daily activity ---------------- */}
            <section className="min-w-0 rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
                <h2 className="mr-auto text-sm font-semibold text-slate-800">Daily activity</h2>
                <Select value={who} onValueChange={(v) => setWho(v ?? "all")}>
                  <SelectTrigger className="h-8 w-auto text-xs" aria-label="Filter by installer">
                    {/* Base UI pinta el VALOR crudo, no la etiqueta del item:
                        con <SelectValue/> a secas el filtro decia "all". */}
                    <SelectValue>
                      {who === "all"
                        ? "All installers"
                        : (data.installers.find((i) => String(i.installerId) === who)?.name ??
                           "All installers")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All installers</SelectItem>
                    {data.installers.map((i) => (
                      <SelectItem key={i.installerId} value={String(i.installerId)}>
                        {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={(v) => setStatus(v ?? "all")}>
                  <SelectTrigger className="h-8 w-auto text-xs" aria-label="Filter by status">
                    <SelectValue>
                      {status === "all"
                        ? "All status"
                        : status === "completed"
                          ? "Completed"
                          : "Scheduled"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All status</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {shown.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <CalendarDays size={22} className="mx-auto mb-2 text-slate-300" aria-hidden />
                  <p className="text-sm font-medium text-slate-600">
                    {data.installers.length === 0
                      ? "No installation days this week."
                      : "No days match this filter."}
                  </p>
                  {/* Una semana vacia sin contexto deja a la persona sin saber
                      si el sistema fallo o si de verdad no se trabajo. Si hay
                      actividad en otra semana, se dice y se lleva hasta ahi. */}
                  {data.installers.length === 0 && data.lastActivityDate && (
                    data.lastActivityDate < from ? (
                      <>
                        <p className="mt-1 text-xs text-slate-500">
                          Last activity was {dayLabel(data.lastActivityDate)}.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => setRange(weekOf(parseYmd(data.lastActivityDate!)))}
                        >
                          Go to that week
                        </Button>
                      </>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">
                        A day shows up here once an order with that install date is
                        marked Installed — or as soon as one is scheduled.
                      </p>
                    )
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <caption className="sr-only">
                      Installer pay by day for {formatRange(range)}
                    </caption>
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-400">
                        <th scope="col" className="px-4 py-2 font-medium">Date</th>
                        <th scope="col" className="px-3 py-2 font-medium">Doors</th>
                        <th scope="col" className="px-3 py-2 font-medium">Work mode</th>
                        <th scope="col" className="px-3 py-2 font-medium">Incidents</th>
                        <th scope="col" className="px-3 py-2 font-medium">Notes</th>
                        <th scope="col" className="px-3 py-2 font-medium">Status</th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    {shown.map((inst) => (
                      <tbody key={inst.installerId} className="border-b border-slate-100 last:border-0">
                        <tr className="bg-slate-50/70">
                          <td colSpan={4} className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <UserRound size={14} className="text-slate-400" aria-hidden />
                              <span className="font-semibold text-slate-800">{inst.name}</span>
                              {inst.rule && !inst.rule.isOwn && (
                                <span
                                  className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                                  title="No rule of their own — using the default."
                                >
                                  default rule
                                </span>
                              )}
                              <span className="truncate text-[11px] text-slate-500">
                                {ruleSentence(inst.rule)}
                              </span>
                            </div>
                          </td>
                          <td colSpan={2} className="px-3 py-2 text-right text-xs text-slate-500">
                            {fmtNum(inst.doors)} doors · {inst.days.length} day
                            {inst.days.length === 1 ? "" : "s"}
                            {/* Lo que el piso diario hizo visible: tres puertas
                                en tres dias cuestan 150 cada una; seis en un
                                dia, 35. Misma tarifa, distinta agenda. */}
                            {costPerDoor(inst) !== null && (
                              <span
                                className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600"
                                title="All-in cost of each installed door this period"
                              >
                                {fmtMoney(costPerDoor(inst)!)}/door
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span className="font-semibold tabular-nums text-slate-900">
                                {fmtMoney(inst.total)}
                                {inst.scheduledAmount > 0 && (
                                  <span className="ml-1 text-[11px] font-normal text-slate-500">
                                    +{fmtMoney(inst.scheduledAmount)}
                                  </span>
                                )}
                              </span>
                              {inst.installerId !== 0 && planSettle(inst).days > 0 && (
                                <Button
                                  variant="outline"
                                  size="xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSettling(inst);
                                  }}
                                >
                                  <BadgeCheck size={12} aria-hidden />
                                  Pay
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {inst.days.map((d) => {
                          const isOpen = expanded.has(d.key);
                          const expandable = d.lines.length > 0;
                          return (
                            <Fragment key={d.key}>
                              <tr
                                onClick={() => expandable && toggle(d.key)}
                                tabIndex={expandable ? 0 : undefined}
                                role={expandable ? "button" : undefined}
                                aria-expanded={expandable ? isOpen : undefined}
                                onKeyDown={(e) => {
                                  if (!expandable) return;
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggle(d.key);
                                  }
                                }}
                                className={cn(
                                  "border-t border-slate-50",
                                  expandable &&
                                    "cursor-pointer hover:bg-slate-50/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-600",
                                )}
                              >
                                <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                                  <span className="flex items-center gap-1">
                                    {d.lines.length > 0 && (
                                      <ChevronDown
                                        size={12}
                                        className={cn("text-slate-300 transition-transform", isOpen && "rotate-180")}
                                      />
                                    )}
                                    {dayLabel(d.date)}
                                  </span>
                                </td>
                                <td className="px-3 py-2 tabular-nums text-slate-700">{fmtNum(d.doors)}</td>
                                <td className="px-3 py-2">
                                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", MODE_BADGE[d.workMode])}>
                                    {MODE_LABEL[d.workMode]}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-xs">
                                  {d.incidents > 0 ? (
                                    <span className="font-medium text-rose-600">Yes ({d.incidents})</span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="max-w-[220px] px-3 py-2 text-xs text-slate-500">
                                  {d.notes.length ? (
                                    <span className="line-clamp-1" title={d.notes.join(" | ")}>
                                      {d.notes[0]}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <span
                                    className={cn(
                                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                      d.status === "completed"
                                        ? "bg-emerald-50 text-emerald-700"
                                        : "bg-sky-50 text-sky-700",
                                    )}
                                  >
                                    {d.status === "completed" ? "Completed" : "Scheduled"}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-900">
                                  {inst.installerId === 0 ? (
                                    // La pantalla ya mostraba el trabajo sin
                                    // asignar; sin esto habia que irse a la
                                    // orden para poder hacer algo con el.
                                    <Button
                                      variant="outline"
                                      size="xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAssigning({ day: d });
                                      }}
                                    >
                                      <UserPlus size={12} aria-hidden />
                                      Assign
                                    </Button>
                                  ) : (
                                    <>
                                      {fmtMoney(d.amount)}
                                      {d.status === "scheduled" && (
                                        <span className="ml-1 text-[10px] text-slate-500">est.</span>
                                      )}
                                    </>
                                  )}
                                </td>
                              </tr>
                              {isOpen && (
                                <tr className="bg-slate-50/40">
                                  <td colSpan={7} className="px-4 py-2">
                                    {/* Why the day paid what it paid. Without this,
                                        a $150 day for 3 doors is a number nobody
                                        can defend to the person receiving it. */}
                                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                                      {d.lines.map((l, idx) => (
                                        <li
                                          key={idx}
                                          className={cn(
                                            "flex items-center justify-between gap-3 px-3 py-1.5 text-xs",
                                            l.kind !== "work" && "bg-amber-50/40",
                                          )}
                                        >
                                          <span className="min-w-0 flex-1 truncate text-slate-600">
                                            {l.kind !== "work" && (
                                              <Info size={11} className="mr-1 inline-block text-amber-600" aria-hidden />
                                            )}
                                            {l.description}
                                          </span>
                                          <span className="shrink-0 tabular-nums text-slate-400">
                                            {fmtNum(l.quantity)} × {fmtMoney(l.rate)}
                                          </span>
                                          <span className="w-16 shrink-0 text-right tabular-nums text-slate-700">
                                            {fmtMoney(l.amount)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    ))}
                  </table>
                </div>
              )}
            </section>

            {/* ---------------- Right rail ---------------- */}
            <aside className="space-y-4">
              <Panel icon={Receipt} title="Payment summary">
                <ul className="space-y-1.5 text-sm">
                  {data.installers.map((i) => (
                    <li key={i.installerId} className="flex items-center justify-between">
                      <span className="truncate text-slate-600">{i.name}</span>
                      <span className="tabular-nums font-medium text-emerald-700">{fmtMoney(i.total)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total payable</span>
                  <span className="text-lg font-bold tabular-nums text-emerald-700">{fmtMoney(s!.total)}</span>
                </div>
                {s!.scheduledAmount > 0 && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    + {fmtMoney(s!.scheduledAmount)} projected for {s!.daysScheduled} scheduled day
                    {s!.daysScheduled === 1 ? "" : "s"} — not owed yet.
                  </p>
                )}
              </Panel>

              <Panel icon={CheckCircle2} title="Work mode summary">
                <ModeBars byMode={s!.byMode} />
              </Panel>

              <Panel icon={CircleDollarSign} title="Payment rules">
                {/* Los numeros configurados de verdad, no solo la leyenda:
                    en una semana sin actividad esto es lo unico que la
                    pantalla puede afirmar con certeza. */}
                <ul className="mb-3 space-y-1.5 border-b border-slate-100 pb-3 text-xs">
                  {data.rules.map((r) => (
                    <li key={r.partnerId ?? "default"} className="flex flex-col">
                      <span className="font-medium text-slate-700">
                        {r.partnerName ?? "Everyone else"}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {ruleSentence({
                          ratePerDoor: r.ratePerDoor,
                          dailyMinimum: r.dailyMinimum,
                          bonusAmount: r.bonusAmount,
                          bonusUnit: r.bonusUnit,
                          isOwn: r.partnerId !== null,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
                <ul className="space-y-2 text-[11px] leading-snug text-slate-500">
                  <li className="flex gap-2">
                    <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", MODE_DOT.per_door)} />
                    <span>
                      <b className="text-slate-700">Per Door</b> — the day&apos;s doors beat the floor, so
                      it&apos;s paid per door.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", MODE_DOT.daily)} />
                    <span>
                      <b className="text-slate-700">Daily Rate</b> — this installer doesn&apos;t charge per
                      door; the day rate is the whole deal.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", MODE_DOT.guarantee)} />
                    <span>
                      <b className="text-slate-700">Min. Guarantee</b> — the doors fell short, so the floor
                      topped the day up.
                    </span>
                  </li>
                </ul>
                <Link
                  href="/settings"
                  className="mt-3 inline-block text-[11px] font-medium text-indigo-600 hover:underline"
                >
                  Edit the rules →
                </Link>
              </Panel>

              {data.incidents.length > 0 && (
                <Panel icon={AlertTriangle} title="Incident summary">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Reported this week</span>
                    <span className="font-semibold tabular-nums text-rose-600">{data.incidents.length}</span>
                  </div>
                </Panel>
              )}
            </aside>
          </div>

          {/* ---------------- Incidents ---------------- */}
          {data.incidents.length > 0 && (
            <section className="mt-4 rounded-xl border border-slate-200 bg-white">
              <h2 className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
                <AlertTriangle size={15} className="text-rose-500" />
                Incidents reported
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <caption className="sr-only">Incidents reported in this period</caption>
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th scope="col" className="px-4 py-2 font-medium">Date</th>
                      <th scope="col" className="px-3 py-2 font-medium">Order / Client</th>
                      <th scope="col" className="px-3 py-2 font-medium">Type</th>
                      <th scope="col" className="px-3 py-2 font-medium">Description</th>
                      <th scope="col" className="px-4 py-2 font-medium">Reported by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.incidents.map((i) => (
                      <tr key={i.id} className="border-t border-slate-50">
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                          {dayLabel(i.date.slice(0, 10))}
                        </td>
                        <td className="px-3 py-2">
                          {i.orderId ? (
                            <Link href={`/orders/${i.orderId}`} className="text-indigo-600 hover:underline">
                              {i.order}
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                          {i.client && <div className="text-[11px] text-slate-400">{i.client}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium capitalize text-rose-700">
                            {i.category}
                          </span>
                        </td>
                        <td className="max-w-[320px] px-3 py-2 text-xs text-slate-600">
                          <span className="line-clamp-2">{i.description}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">
                          {i.reportedBy ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* Marcar pagado mueve plata: el dialogo dice cuanto y cuantos dias
          ANTES de confirmar, y de donde no sale (lo agendado). */}
      <Dialog open={settling !== null} onOpenChange={(o) => !o && setSettling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark the week as paid</DialogTitle>
            <DialogDescription>
              {settling && (
                <>
                  This marks <b>{planSettle(settling).days}</b> worked day
                  {planSettle(settling).days === 1 ? "" : "s"} for{" "}
                  <b>{settling.name}</b> as paid, totalling{" "}
                  <b>{fmtMoney(planSettle(settling).amount)}</b>.
                  {settling.scheduledAmount > 0 && (
                    <>
                      {" "}
                      Scheduled days are left out — nothing has been earned on them
                      yet.
                    </>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettling(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={confirmSettle} disabled={busy}>
              {busy ? "Marking…" : "Mark as paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assigning !== null} onOpenChange={(o) => !o && setAssigning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign an installer</DialogTitle>
            <DialogDescription>
              {assigning && (
                <>
                  {assigning.day.orders.length} order
                  {assigning.day.orders.length === 1 ? "" : "s"} scheduled for{" "}
                  {dayLabel(assigning.day.date)}:{" "}
                  {assigning.day.orders.map((o) => o.name).join(", ")}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1">
            {(people?.installers ?? []).map((p2) => (
              <li key={p2.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => confirmAssign(p2.id)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-600"
                >
                  {p2.name}
                </button>
              </li>
            ))}
            {people && people.installers.length === 0 && (
              <li className="text-sm text-slate-500">No installers configured.</li>
            )}
            {!people && <li className="text-sm text-slate-500">Loading…</li>}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssigning(null)} disabled={busy}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({
  icon: Icon,
  tone,
  bg,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  tone: string;
  bg: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", bg)}>
        <Icon size={18} className={tone} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-slate-500">{label}</div>
        <div className="text-xl font-semibold tabular-nums leading-tight text-slate-900">{value}</div>
        <div className="truncate text-[11px] text-slate-500">{hint}</div>
      </div>
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Users;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <Icon size={14} className="text-slate-400" />
        {title}
      </h3>
      {children}
    </div>
  );
}

/** Doors by which branch of the rule paid for them. Bars rather than a donut:
 *  with three slices the comparison people actually make is "which is bigger",
 *  and a bar answers that without decoding angles. */
function ModeBars({ byMode }: { byMode: Record<WorkMode, number> }) {
  const total = byMode.per_door + byMode.daily + byMode.guarantee;
  if (!total) return <p className="text-xs text-slate-400">No doors this week.</p>;
  const modes: WorkMode[] = ["per_door", "daily", "guarantee"];
  return (
    <ul className="space-y-2">
      {modes.map((m) => {
        const pct = Math.round((byMode[m] / total) * 100);
        return (
          <li key={m}>
            <div className="mb-0.5 flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className={cn("h-2 w-2 rounded-full", MODE_DOT[m])} />
                {MODE_LABEL[m]}
              </span>
              <span className="tabular-nums text-slate-500">
                {fmtNum(byMode[m])} ({pct}%)
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={cn("h-full rounded-full", MODE_DOT[m])} style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
