"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Date range control: quick presets, week stepping, and a real custom range.
 *
 * The arrows-only version this replaces could only walk one week at a time.
 * Getting to last month meant four clicks and a guess about which week you
 * had landed on, and there was no way to ask for a range at all.
 *
 * Native <input type="date"> on purpose: it is keyboard-operable and
 * screen-reader-labelled for free, it speaks the user's locale, and on a
 * phone it opens the OS picker. A hand-rolled calendar would be prettier and
 * worse at all three.
 */

export interface DateRange {
  from: string;
  to: string;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}

export function weekOf(d: Date): DateRange {
  const monday = mondayOf(d);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: ymd(monday), to: ymd(sunday) };
}

type PresetId = "this_week" | "last_week" | "this_month" | "last_30" | "custom";

const PRESETS: Array<{ id: PresetId; label: string; build?: () => DateRange }> = [
  { id: "this_week", label: "This week", build: () => weekOf(new Date()) },
  {
    id: "last_week",
    label: "Last week",
    build: () => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return weekOf(d);
    },
  },
  {
    id: "this_month",
    label: "This month",
    build: () => {
      const now = new Date();
      return {
        from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    },
  },
  {
    id: "last_30",
    label: "Last 30 days",
    build: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(to.getDate() - 29);
      return { from: ymd(from), to: ymd(to) };
    },
  },
  { id: "custom", label: "Custom range" },
];

/** Which preset, if any, a range corresponds to — so reopening the control
 *  highlights what is actually on screen instead of always saying "custom". */
function presetFor(range: DateRange): PresetId {
  for (const p of PRESETS) {
    if (!p.build) continue;
    const r = p.build();
    if (r.from === range.from && r.to === range.to) return p.id;
  }
  return "custom";
}

export function formatRange(r: DateRange): string {
  const f = (s: string, withYear: boolean) =>
    parseYmd(s).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    });
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  if (r.from === r.to) return f(r.from, true);
  return `${f(r.from, !sameYear)} – ${f(r.to, true)}`;
}

export function DateRangePicker({
  value,
  onChange,
  maxDays,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  /** Server-side cap, mirrored here so the user is told before they submit. */
  maxDays?: number;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const active = presetFor(value);

  const span =
    Math.round(
      (parseYmd(draft.to).getTime() - parseYmd(draft.from).getTime()) / 86400000,
    ) + 1;
  const invalid = draft.from > draft.to;
  const tooWide = maxDays !== undefined && span > maxDays;

  /** Step by whatever the current range spans — a week moves by a week, a
   *  month by a month's worth of days. Stepping by a fixed week would jump
   *  out of a custom range into nowhere. */
  function step(dir: -1 | 1) {
    const len =
      Math.round(
        (parseYmd(value.to).getTime() - parseYmd(value.from).getTime()) / 86400000,
      ) + 1;
    const from = parseYmd(value.from);
    const to = parseYmd(value.to);
    from.setDate(from.getDate() + dir * len);
    to.setDate(to.getDate() + dir * len);
    onChange({ from: ymd(from), to: ymd(to) });
  }

  return (
    <div className="relative flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
      <Button variant="ghost" size="icon-xs" onClick={() => step(-1)} aria-label="Previous period">
        <ChevronLeft size={16} />
      </Button>

      <button
        type="button"
        onClick={() => {
          // El borrador se refresca al ABRIR, no en cada cambio del rango:
          // asi el dialogo siempre parte de lo que hay en pantalla y no hace
          // falta un efecto que persiga la prop.
          setDraft(value);
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        <CalendarDays size={14} className="text-slate-500" />
        {formatRange(value)}
      </button>

      <Button variant="ghost" size="icon-xs" onClick={() => step(1)} aria-label="Next period">
        <ChevronRight size={16} />
      </Button>

      {open && (
        <>
          {/* Click-away. aria-hidden: the Escape/close affordance that matters
              for keyboards is the dialog's own Cancel button. */}
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Choose a date range"
            className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          >
            <ul className="mb-3 space-y-0.5">
              {PRESETS.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (p.build) {
                        onChange(p.build());
                        setOpen(false);
                      }
                    }}
                    aria-current={active === p.id ? "true" : undefined}
                    className={cn(
                      "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-600",
                      active === p.id
                        ? "bg-indigo-50 font-medium text-indigo-700"
                        : "text-slate-700",
                    )}
                  >
                    {p.label}
                  </button>
                </li>
              ))}
            </ul>

            <div className="space-y-2 border-t border-slate-100 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="range-from" className="text-[11px] text-slate-500">
                    From
                  </Label>
                  <input
                    id="range-from"
                    type="date"
                    value={draft.from}
                    max={draft.to}
                    onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                    className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-indigo-600"
                  />
                </div>
                <div>
                  <Label htmlFor="range-to" className="text-[11px] text-slate-500">
                    To
                  </Label>
                  <input
                    id="range-to"
                    type="date"
                    value={draft.to}
                    min={draft.from}
                    onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                    className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-indigo-600"
                  />
                </div>
              </div>

              {/* Say why the button is disabled. A dead button with no
                  explanation is the most common dead end in a form. */}
              {(invalid || tooWide) && (
                <p role="alert" className="text-[11px] text-rose-600">
                  {invalid
                    ? "The start date has to come before the end date."
                    : `That's ${span} days — the maximum is ${maxDays}.`}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="xs"
                  disabled={invalid || tooWide}
                  onClick={() => {
                    onChange(draft);
                    setOpen(false);
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
