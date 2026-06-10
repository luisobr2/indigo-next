"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  Clock,
  Calendar,
  AlertOctagon,
} from "lucide-react";
import { fmtDateTime, cn } from "@/lib/utils";

interface TimelineEntry {
  code: string;
  label: string;
  date: string | null;
  isCurrent: boolean;
}

interface Props {
  orderId: number;
  /** Hide the "Closed" tail unless the order has reached it. */
  hideUnreached?: boolean;
}

export function ProductionTimeline({ orderId }: Props) {
  const { data, isLoading } = useQuery<{
    timeline: TimelineEntry[];
    cancelled_at: string | null;
    current_stage_code: string;
  }>({
    queryKey: ["order-timeline", orderId],
    queryFn: () => fetch(`/api/orders/${orderId}/timeline`).then((r) => r.json()),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
          <Calendar size={16} className="text-indigo-700" />
          Production Timeline
        </h3>
        <p className="text-xs text-slate-400">Loading…</p>
      </div>
    );
  }
  const entries = data?.timeline ?? [];
  if (!entries.length) return null;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-800">
        <Calendar size={16} className="text-indigo-700" />
        Production Timeline
      </h3>

      {data?.cancelled_at && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <AlertOctagon size={12} />
          Order cancelled on {fmtDateTime(data.cancelled_at)}.
        </div>
      )}

      <ol className="relative space-y-2.5">
        {entries.map((e, i) => {
          const reached = !!e.date;
          const future = !reached && !e.isCurrent;
          return (
            <li key={e.code} className="flex items-start gap-3">
              <span className="mt-0.5 flex flex-col items-center">
                {reached && !e.isCurrent ? (
                  <CheckCircle2
                    size={16}
                    className="shrink-0 text-emerald-500"
                  />
                ) : e.isCurrent ? (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-700 ring-4 ring-indigo-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                ) : (
                  <Circle size={16} className="shrink-0 text-slate-200" />
                )}
                {i < entries.length - 1 && (
                  <span
                    className={cn(
                      "mt-1 w-0.5 flex-1 min-h-[12px]",
                      reached || e.isCurrent ? "bg-emerald-200" : "bg-slate-100",
                    )}
                  />
                )}
              </span>
              <div className="min-w-0 flex-1 pb-1.5">
                <div
                  className={cn(
                    "text-sm font-semibold",
                    e.isCurrent
                      ? "text-indigo-700"
                      : reached
                        ? "text-slate-800"
                        : "text-slate-400",
                  )}
                >
                  {e.label}
                  {e.isCurrent && (
                    <span className="ml-1.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                      Now
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  {reached ? (
                    <span className="flex items-center gap-1">
                      <Clock size={9} className="text-slate-400" />
                      {fmtDateTime(e.date as string)}
                    </span>
                  ) : future ? (
                    "Pending"
                  ) : (
                    "In progress"
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
