"use client";

import { cn } from "@/lib/utils";

/**
 * Phone input with a country selector. Defaults to the US (+1).
 *
 * The value is stored as a single string "<dial> <number>" (e.g.
 * "+1 305 555 1234"). The country is derived back from the dial prefix, so the
 * component stays controlled with a plain string value — no extra state to wire
 * in the parent forms.
 */
interface Country {
  code: string;
  flag: string;
  dial: string;
  name: string;
}

// US first (default). One entry per dial code so the dial -> country lookup is
// unambiguous; covers the US + the countries Indigo's clients come from.
const COUNTRIES: Country[] = [
  { code: "US", flag: "🇺🇸", dial: "+1", name: "United States" },
  { code: "MX", flag: "🇲🇽", dial: "+52", name: "Mexico" },
  { code: "CO", flag: "🇨🇴", dial: "+57", name: "Colombia" },
  { code: "CU", flag: "🇨🇺", dial: "+53", name: "Cuba" },
  { code: "VE", flag: "🇻🇪", dial: "+58", name: "Venezuela" },
  { code: "AR", flag: "🇦🇷", dial: "+54", name: "Argentina" },
  { code: "PE", flag: "🇵🇪", dial: "+51", name: "Peru" },
  { code: "CL", flag: "🇨🇱", dial: "+56", name: "Chile" },
  { code: "BR", flag: "🇧🇷", dial: "+55", name: "Brazil" },
  { code: "ES", flag: "🇪🇸", dial: "+34", name: "Spain" },
  { code: "HN", flag: "🇭🇳", dial: "+504", name: "Honduras" },
  { code: "GT", flag: "🇬🇹", dial: "+502", name: "Guatemala" },
  { code: "SV", flag: "🇸🇻", dial: "+503", name: "El Salvador" },
  { code: "NI", flag: "🇳🇮", dial: "+505", name: "Nicaragua" },
  { code: "CR", flag: "🇨🇷", dial: "+506", name: "Costa Rica" },
  { code: "PA", flag: "🇵🇦", dial: "+507", name: "Panama" },
  { code: "EC", flag: "🇪🇨", dial: "+593", name: "Ecuador" },
];

const dialOf = (code: string) =>
  COUNTRIES.find((c) => c.code === code)?.dial ?? "+1";

/** Split "<dial> <number>" into the country code + the local number. Anything
 *  without a leading dial is treated as a US number. */
function parse(value: string | null | undefined): { code: string; number: string } {
  const v = (value ?? "").trim();
  if (v.startsWith("+")) {
    const byLongestDial = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    const c = byLongestDial.find((c) => v.startsWith(c.dial));
    if (c) return { code: c.code, number: v.slice(c.dial.length).trim() };
  }
  return { code: "US", number: v };
}

export function PhoneField({
  value,
  onChange,
  id,
  className,
  placeholder = "305 555 1234",
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
}) {
  const { code, number } = parse(value);

  function emit(nextCode: string, nextNumber: string) {
    // Keep the number as typed (don't trim) so spaces between digit groups
    // survive typing; only collapse to empty when there's nothing real.
    onChange(nextNumber.trim() ? `${dialOf(nextCode)} ${nextNumber}` : "");
  }

  return (
    <div className={cn("flex", className)}>
      <select
        aria-label="Country code"
        value={code}
        onChange={(e) => emit(e.target.value, number)}
        className="h-10 rounded-l-lg border border-r-0 border-input bg-background px-2 text-sm shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.dial}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        value={number}
        onChange={(e) => emit(code, e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-r-lg border border-input bg-background px-3 text-sm shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
    </div>
  );
}
