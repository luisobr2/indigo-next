"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Plus,
  MapPin,
  Copy,
  Check,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ScheduleOnDayModal,
  type PendingOrder,
} from "@/components/schedule-on-day-modal";

// Capability token for the .ics feed; matches the API fallback. Not a hard
// secret — the whole point is to hand this URL to a calendar client.
const ICS_TOKEN =
  process.env.NEXT_PUBLIC_CALENDAR_ICS_TOKEN ?? "idg-cal-2f8a91c47e6b5d30";

interface CalEvent {
  id: number;
  name: string;
  dealer_ref: string;
  dealer_id: number;
  dealer_name: string;
  client_name: string;
  client_address: string;
  date: string; // YYYY-MM-DD
  door_count: number;
  stage_code: string;
}

interface CalendarResponse {
  events: CalEvent[];
  pending: PendingOrder[];
}

// Stable palette so each dealer keeps a consistent colour across the grid.
const DEALER_COLORS = [
  "bg-indigo-100 text-indigo-800 ring-indigo-200",
  "bg-emerald-100 text-emerald-800 ring-emerald-200",
  "bg-amber-100 text-amber-800 ring-amber-200",
  "bg-sky-100 text-sky-800 ring-sky-200",
  "bg-rose-100 text-rose-800 ring-rose-200",
  "bg-violet-100 text-violet-800 ring-violet-200",
  "bg-teal-100 text-teal-800 ring-teal-200",
];
function dealerColor(id: number) {
  return DEALER_COLORS[id % DEALER_COLORS.length];
}

function ymd(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarPage() {
  const router = useRouter();
  // `cursor` is any day inside the displayed month.
  const [cursor, setCursor] = useState(() => new Date());
  const [dayTarget, setDayTarget] = useState<string | null>(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedUrl, setFeedUrl] = useState("");

  useEffect(() => {
    setFeedUrl(`${window.location.origin}/api/calendar.ics?token=${ICS_TOKEN}`);
  }, []);

  const year = cursor.getFullYear();
  const month = cursor.getMonth(); // 0-based

  // Grid spans whole weeks (Mon-start) covering the month.
  const { gridStart, gridEnd, weeks } = useMemo(() => {
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Mon=0
    const start = new Date(year, month, 1 - startOffset);
    const last = new Date(year, month + 1, 0);
    const endOffset = (7 - ((last.getDay() + 6) % 7) - 1 + 7) % 7;
    const end = new Date(year, month + 1, endOffset);
    const days: Date[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    const wk: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) wk.push(days.slice(i, i + 7));
    return { gridStart: start, gridEnd: end, weeks: wk };
  }, [year, month]);

  const { data, isLoading } = useQuery<CalendarResponse>({
    queryKey: ["calendar", ymd(gridStart), ymd(gridEnd)],
    queryFn: () =>
      fetch(`/api/calendar?from=${ymd(gridStart)}&to=${ymd(gridEnd)}`).then((r) =>
        r.json(),
      ),
  });

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of data?.events ?? []) {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    }
    return map;
  }, [data]);

  const todayStr = ymd(new Date());
  const monthLabel = cursor.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const pendingCount = data?.pending.length ?? 0;

  function shiftMonth(delta: number) {
    setCursor(new Date(year, month + delta, 1));
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <CalendarDays className="text-indigo-700" size={26} />
            Installations Calendar
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Scheduled installations by day. Click an installation to open it, or
            an empty day to schedule a pending one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800">
              {pendingCount} pending to schedule
            </span>
          )}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-[140px] text-center text-sm font-semibold text-slate-800">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <Button variant="outline" size="lg" onClick={() => setCursor(new Date())}>
            Today
          </Button>
          <Button
            size="lg"
            onClick={() => setSubscribeOpen(true)}
            className="bg-indigo-700 text-white shadow shadow-indigo-700/20 hover:bg-indigo-800"
          >
            <CalendarPlus size={16} /> Add to my calendar
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2">
              {d}
            </div>
          ))}
        </div>

        {isLoading && (
          <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
        )}

        {!isLoading &&
          weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0">
              {week.map((day) => {
                const dStr = ymd(day);
                const inMonth = day.getMonth() === month;
                const isToday = dStr === todayStr;
                const dayEvents = eventsByDay.get(dStr) ?? [];
                return (
                  <button
                    key={dStr}
                    type="button"
                    onClick={() => setDayTarget(dStr)}
                    className={cn(
                      "group min-h-[112px] border-r border-slate-100 p-1.5 text-left align-top last:border-r-0 hover:bg-slate-50/70",
                      !inMonth && "bg-slate-50/40",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                          isToday
                            ? "bg-indigo-700 text-white"
                            : inMonth
                              ? "text-slate-700"
                              : "text-slate-300",
                        )}
                      >
                        {day.getDate()}
                      </span>
                      <Plus
                        size={13}
                        className="text-slate-300 opacity-0 transition group-hover:opacity-100"
                      />
                    </div>
                    <div className="space-y-1">
                      {dayEvents.slice(0, 4).map((e) => (
                        <div
                          key={e.id}
                          role="link"
                          tabIndex={0}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            router.push(`/orders/${e.id}`);
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") {
                              ev.stopPropagation();
                              router.push(`/orders/${e.id}`);
                            }
                          }}
                          title={`${e.dealer_ref || e.name} — ${e.client_name}\n${e.client_address}`}
                          className={cn(
                            "cursor-pointer truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset hover:brightness-95",
                            dealerColor(e.dealer_id),
                          )}
                        >
                          <span className="font-semibold">{e.client_name}</span>
                          {e.door_count > 1 ? ` · ${e.door_count}d` : ""}
                        </div>
                      ))}
                      {dayEvents.length > 4 && (
                        <div className="px-1.5 text-[10px] font-medium text-slate-400">
                          +{dayEvents.length - 4} more
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
      </div>

      {/* Dealer legend */}
      {data && data.events.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <MapPin size={12} /> Colored by dealer:
          </span>
          {Array.from(
            new Map(data.events.map((e) => [e.dealer_id, e.dealer_name])).entries(),
          ).map(([id, name]) => (
            <span key={id} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block h-3 w-3 rounded-full ring-1 ring-inset",
                  dealerColor(id),
                )}
              />
              {name || "—"}
            </span>
          ))}
        </div>
      )}

      <ScheduleOnDayModal
        date={dayTarget}
        pending={data?.pending ?? []}
        onClose={() => setDayTarget(null)}
        onScheduled={() => setDayTarget(null)}
      />

      <Dialog open={subscribeOpen} onOpenChange={setSubscribeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus size={16} className="text-indigo-700" />
              Add installations to your calendar
            </DialogTitle>
            <DialogDescription>
              Subscribe once and every scheduled installation shows up in your
              Google / Apple calendar — with a reminder the day before. It stays
              in sync automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-600">
                Subscription link
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={feedUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-9 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 font-mono text-xs text-slate-700"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(feedUrl);
                      setCopied(true);
                      toast.success("Link copied");
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      toast.error("Could not copy");
                    }
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
              <li>Open Google Calendar on a computer.</li>
              <li>
                Left side: <strong>Other calendars</strong> → <strong>+</strong>{" "}
                → <strong>From URL</strong>.
              </li>
              <li>Paste the link above and click <strong>Add calendar</strong>.</li>
            </ol>

            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              Prefer a one-time import (no auto-sync)? Use{" "}
              <a
                href={feedUrl}
                className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline"
              >
                <Download size={12} /> download the .ics file
              </a>{" "}
              and import it into your calendar.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
