"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CircleDollarSign,
  DoorOpen,
  Info,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import { fmtMoney, fmtNum, cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { ErrorState } from "@/components/state-cards";
import { Button } from "@/components/ui/button";

interface PayLine {
  kind: "work" | "minimum" | "bonus";
  description: string;
  order: string | null;
  quantity: number;
  rate: number;
  amount: number;
}

interface PayDay {
  payoutId: number;
  payoutName: string;
  date: string;
  doors: number;
  installs: number;
  amount: number;
  state: "draft" | "approved" | "paid" | "cancel";
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
  daysAtMinimum: number;
}

interface PayData {
  rangeStart: string;
  rangeEnd: string;
  summary: {
    installers: number;
    daysWorked: number;
    doors: number;
    total: number;
    pending: number;
    settled: number;
    daysAtMinimum: number;
  };
  installers: Installer[];
}

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Build the Date from the parts — `new Date("2026-08-17")` parses as UTC and
 *  shows the day before for anyone west of Greenwich, which is everyone here. */
function longDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** One sentence for how this person gets paid, in the shop's own words. */
function ruleSentence(rule: Installer["rule"]): string {
  if (!rule) return "No payment rule configured — falling back to per-door only.";
  const bits: string[] = [];
  if (rule.ratePerDoor > 0) bits.push(`${fmtMoney(rule.ratePerDoor)} per door`);
  if (rule.dailyMinimum > 0) {
    bits.push(
      rule.ratePerDoor > 0
        ? `never less than ${fmtMoney(rule.dailyMinimum)} a day`
        : `${fmtMoney(rule.dailyMinimum)} a day`,
    );
  }
  if (rule.bonusAmount > 0) {
    bits.push(`+ ${fmtMoney(rule.bonusAmount)} per ${rule.bonusUnit === "door" ? "door" : "install"}`);
  }
  return bits.join(", ") || "No rate configured.";
}

export default function InstallersPage() {
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const from = ymd(monday);
  const to = ymd(sunday);

  const { data, isLoading, error, refetch } = useQuery<PayData>({
    queryKey: ["installer-pay", from, to],
    queryFn: () => fetchJson(`/api/installers/pay?from=${from}&to=${to}`),
  });

  const [open, setOpen] = useState<number | null>(null);

  function shiftWeek(delta: number) {
    const next = new Date(monday);
    next.setDate(next.getDate() + delta * 7);
    setMonday(mondayOf(next));
  }

  const s = data?.summary;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Wrench size={20} className="text-emerald-600" />
            Installers
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            What each installer earned, day by day.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <Button variant="ghost" size="icon-xs" onClick={() => shiftWeek(-1)} aria-label="Previous week">
            <ChevronLeft size={16} />
          </Button>
          <span className="px-2 text-sm font-medium tabular-nums text-slate-700">
            {longDate(from)} — {longDate(to)}
          </span>
          <Button variant="ghost" size="icon-xs" onClick={() => shiftWeek(1)} aria-label="Next week">
            <ChevronRight size={16} />
          </Button>
          <Button variant="outline" size="xs" className="ml-1" onClick={() => setMonday(mondayOf(new Date()))}>
            This week
          </Button>
        </div>
      </header>

      {error ? (
        <ErrorState message="Couldn't load installer pay." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          Loading…
        </div>
      ) : !data || data.installers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 py-12 text-center">
          <CalendarDays size={22} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">No installation days this week.</p>
          <p className="mt-1 text-xs text-slate-400">
            A day appears here once an order with that install date reaches Installed.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi
              icon={CircleDollarSign}
              tone="text-emerald-600"
              label="To pay this week"
              value={fmtMoney(s!.total)}
              hint={s!.settled > 0 ? `${fmtMoney(s!.settled)} already settled` : "Nothing settled yet"}
            />
            <Kpi
              icon={CalendarDays}
              tone="text-indigo-600"
              label="Days worked"
              value={fmtNum(s!.daysWorked)}
              hint={`${s!.installers} installer${s!.installers === 1 ? "" : "s"}`}
            />
            <Kpi
              icon={DoorOpen}
              tone="text-sky-600"
              label="Doors installed"
              value={fmtNum(s!.doors)}
              hint={
                s!.daysWorked
                  ? `${(s!.doors / s!.daysWorked).toFixed(1)} per day`
                  : "—"
              }
            />
            <Kpi
              icon={ShieldCheck}
              tone="text-amber-600"
              label="Days at the minimum"
              value={`${s!.daysAtMinimum} of ${s!.daysWorked}`}
              hint="The day's doors didn't reach the floor"
            />
          </div>

          <ul className="space-y-3">
            {data.installers.map((inst) => {
              const isOpen = open === inst.installerId;
              return (
                <li
                  key={inst.installerId}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                >
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : inst.installerId)}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <ChevronDown
                      size={16}
                      className={cn(
                        "shrink-0 text-slate-400 transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-slate-900">{inst.name}</span>
                        {inst.rule && !inst.rule.isOwn && (
                          <span
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
                            title="No rule of their own — using the default one."
                          >
                            default rule
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{ruleSentence(inst.rule)}</p>
                    </div>
                    <Stat label="days" value={fmtNum(inst.days.length)} />
                    <Stat label="doors" value={fmtNum(inst.doors)} />
                    <Stat label="installs" value={fmtNum(inst.installs)} />
                    <div className="text-right">
                      <div className="text-lg font-semibold tabular-nums text-slate-900">
                        {fmtMoney(inst.total)}
                      </div>
                      {inst.settled > 0 && (
                        <div className="text-[11px] text-slate-400">
                          {fmtMoney(inst.pending)} pending
                        </div>
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                      <ul className="space-y-2">
                        {inst.days.map((d) => (
                          <li key={d.payoutId} className="rounded-lg border border-slate-200 bg-white">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-slate-800">
                                  {longDate(d.date)}
                                </span>
                                <span className="text-xs text-slate-400">
                                  {fmtNum(d.doors)} door{d.doors === 1 ? "" : "s"} ·{" "}
                                  {fmtNum(d.installs)} install{d.installs === 1 ? "" : "s"}
                                </span>
                                <StateBadge state={d.state} />
                              </div>
                              <span className="text-sm font-semibold tabular-nums text-slate-900">
                                {fmtMoney(d.amount)}
                              </span>
                            </div>
                            {/* The breakdown is the point of this page: Majela has
                                to be able to explain the total to the installer by
                                pointing at where each part came from. */}
                            <ul className="divide-y divide-slate-50">
                              {d.lines.map((l, idx) => (
                                <li
                                  key={idx}
                                  className={cn(
                                    "flex items-center justify-between gap-3 px-3 py-1.5 text-xs",
                                    l.kind !== "work" && "bg-amber-50/50",
                                  )}
                                >
                                  <span className="min-w-0 flex-1 truncate text-slate-600">
                                    {l.kind !== "work" && (
                                      <Info size={11} className="mr-1 inline-block text-amber-600" />
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
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  tone: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon size={14} className={tone} />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden text-center sm:block">
      <div className="text-sm font-semibold tabular-nums text-slate-700">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

function StateBadge({ state }: { state: PayDay["state"] }) {
  const map: Record<PayDay["state"], [string, string]> = {
    draft: ["Pending", "bg-slate-100 text-slate-600"],
    approved: ["Approved", "bg-indigo-50 text-indigo-700"],
    paid: ["Paid", "bg-emerald-50 text-emerald-700"],
    cancel: ["Cancelled", "bg-rose-50 text-rose-700"],
  };
  const [label, cls] = map[state];
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", cls)}>{label}</span>;
}
