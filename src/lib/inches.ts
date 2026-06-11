/**
 * US-style inch fraction parsing & formatting.
 *
 * Door measurements in the US are written as a whole number of inches
 * plus a fraction in sixteenths — "23 3/4", "36 1/2", "80 1/16".
 * Backend stores a single float (inches), but every operator (Majela,
 * Javier, the dealers, the painter) reads and writes the fractional
 * form. So the UI parses inbound text and formats outbound decimals.
 *
 * Snap precision is 1/16" (the smallest increment on a standard tape
 * measure). When the user types a decimal we round to the nearest 1/16
 * and warn if the rounding is non-trivial.
 *
 * Accepted input forms:
 *   "23 3/4"      → 23.75
 *   "23  3/4"     → 23.75   (multiple spaces)
 *   "23-3/4"      → 23.75   (dash separator)
 *   "23 3 4"      → 23.75   (3 numbers → treat as `whole num/denom`)
 *   "3/4"         → 0.75    (pure fraction, no whole)
 *   "23.75"       → 23.75   (raw decimal still allowed)
 *   "23"          → 23
 *   '23"' / "23in"→ 23      (trailing " or in stripped)
 *
 * Returns `null` for anything that doesn't parse cleanly so callers
 * can show an inline error.
 */

const FRACTION_RX = /^(\d+)\s*\/\s*(\d+)$/;
const DECIMAL_RX = /^\d+(?:\.\d+)?$/;

export function parseInches(raw: string | number): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (!raw) return null;
  // Strip trailing inch markers, normalize separators, collapse spaces.
  const cleaned = String(raw)
    .toLowerCase()
    .replace(/["”]/g, "")
    .replace(/\bin(ches)?\b/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  // Pure decimal: "23" or "23.5"
  if (DECIMAL_RX.test(cleaned)) {
    return parseFloat(cleaned);
  }

  // Pure fraction: "3/4"
  const pf = cleaned.match(FRACTION_RX);
  if (pf) {
    const n = parseInt(pf[1], 10);
    const d = parseInt(pf[2], 10);
    if (!d) return null;
    return n / d;
  }

  // Whole + fraction: "23 3/4"
  const tokens = cleaned.split(" ");
  if (tokens.length === 2) {
    const whole = tokens[0];
    if (!DECIMAL_RX.test(whole)) return null;
    const fr = tokens[1].match(FRACTION_RX);
    if (!fr) return null;
    const d = parseInt(fr[2], 10);
    if (!d) return null;
    return parseFloat(whole) + parseInt(fr[1], 10) / d;
  }

  // Three tokens: "23 3 4" treat as whole num/denom
  if (tokens.length === 3) {
    if (
      !DECIMAL_RX.test(tokens[0]) ||
      !DECIMAL_RX.test(tokens[1]) ||
      !DECIMAL_RX.test(tokens[2])
    )
      return null;
    const d = parseInt(tokens[2], 10);
    if (!d) return null;
    return (
      parseFloat(tokens[0]) + parseInt(tokens[1], 10) / d
    );
  }

  return null;
}

/**
 * Snap to the nearest 1/16" (or any custom denominator) and format
 * back to "WW FF/DD" form. Whole values render without a fraction.
 */
export function formatInches(
  value: number | null | undefined,
  denominator = 16,
): string {
  if (value == null || !Number.isFinite(value)) return "";
  const whole = Math.floor(value);
  const remainder = value - whole;
  const sixteenths = Math.round(remainder * denominator);
  // Carry: 16/16 → whole + 1
  if (sixteenths === denominator) {
    return String(whole + 1);
  }
  if (sixteenths === 0) {
    return String(whole);
  }
  // Reduce the fraction (gcd) so we render the canonical form
  // "1/2" not "8/16", "3/4" not "12/16".
  const g = gcd(sixteenths, denominator);
  return `${whole} ${sixteenths / g}/${denominator / g}`;
}

function gcd(a: number, b: number): number {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Convenience predicate for inline UI validation. */
export function isValidInchInput(raw: string): boolean {
  return parseInches(raw) != null;
}
