"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { parseInches, formatInches } from "@/lib/inches";

interface Props {
  /**
   * Numeric inches value (e.g. 23.75). The component is controlled —
   * it accepts a number and emits the parsed number on change.
   */
  value: number | "" | null;
  onChange: (value: number | "") => void;
  id?: string;
  placeholder?: string;
  className?: string;
  /**
   * When true, the input renders with a small unit suffix ("in") on
   * the right edge. Defaults to true.
   */
  showUnit?: boolean;
  /**
   * When false, the live "→ X.XXX in" hint underneath the input is
   * suppressed (useful in dense tables).
   */
  showHint?: boolean;
  /**
   * Optional callback fired when the parsed value rounded to 1/16
   * differs from the raw input (so a parent can warn about the snap).
   */
  onSnap?: (snapped: number, raw: number) => void;
}

/**
 * Text input that accepts US-style inch measurements with fractions
 * — "23 3/4", "36-1/2", "3/4", "23.75". Parses to a decimal on every
 * keystroke and emits the parsed number to the parent. Snaps to 1/16"
 * precision on blur so backend never sees odd floats like 23.7499.
 *
 * Use anywhere width/height/SQF-component inches are entered: New
 * Order modal, Edit Order panel, Measurement wizard.
 */
export function FractionalInchInput({
  value,
  onChange,
  id,
  placeholder = `e.g. 23 3/4`,
  className,
  showUnit = true,
  showHint = true,
  onSnap,
}: Props) {
  const [raw, setRaw] = useState<string>(
    value === "" || value == null ? "" : formatInches(value),
  );
  const parsed = parseInches(raw);
  const invalid = raw.trim() !== "" && parsed == null;

  // Keep the local text in sync when the parent forces a new value
  // (e.g. opening Edit Order on a different line).
  useEffect(() => {
    if (value === "" || value == null) {
      // Don't clobber what the user is typing right now — only reset
      // when the parent explicitly clears.
      if (raw === "") return;
      setRaw("");
      return;
    }
    // Treat near-equal as equal to avoid fighting the user mid-edit.
    if (parsed != null && Math.abs(parsed - value) < 1 / 1024) return;
    setRaw(formatInches(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit() {
    const n = parseInches(raw);
    if (n == null) {
      // Snap the visible text back to the last good value so the user
      // sees the canonical fractional form.
      setRaw(value === "" || value == null ? "" : formatInches(value));
      return;
    }
    // Snap to 1/16" precision on blur.
    const snapped = Math.round(n * 16) / 16;
    if (Math.abs(snapped - n) > 1e-6 && onSnap) onSnap(snapped, n);
    onChange(snapped);
    setRaw(formatInches(snapped));
  }

  return (
    <div className={cn("space-y-1", className)}>
      <div className="relative">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={raw}
          placeholder={placeholder}
          onChange={(e) => {
            setRaw(e.target.value);
            const n = parseInches(e.target.value);
            // Emit live so parents that compute SQF in real time stay
            // in sync, but only if the value parses cleanly.
            if (n != null) onChange(n);
            if (e.target.value.trim() === "") onChange("");
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={cn(
            invalid && "border-rose-400 ring-rose-200 focus:border-rose-500",
            showUnit && "pr-9",
          )}
        />
        {showUnit && (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-medium text-slate-400">
            in
          </span>
        )}
      </div>
      {showHint && (
        <div
          className={cn(
            "text-[10px] leading-none",
            invalid
              ? "text-rose-600"
              : parsed != null
                ? "text-slate-400"
                : "text-slate-300",
          )}
        >
          {invalid ? (
            <>Invalid — try “23 3/4” or “23.75”</>
          ) : parsed != null ? (
            <>= {parsed.toFixed(4)}″</>
          ) : (
            <>Use fractions like “23 3/4” or decimals “23.75”</>
          )}
        </div>
      )}
    </div>
  );
}
