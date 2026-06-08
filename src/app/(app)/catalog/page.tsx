"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Boxes,
  Building2,
  Pencil,
  Plus,
  Search,
  Tag,
  ChevronRight,
} from "lucide-react";
import { fmtMoney } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Design {
  id: number;
  code: string;
  name: string;
  description?: string;
  door_type?: string;
  active?: boolean;
}

interface Dealer {
  id: number;
  name: string;
  indigo_default_price_per_sqf?: number;
  active?: boolean;
}

interface Brand {
  id: number;
  name: string;
  code?: string | false;
  active?: boolean;
}

const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "Single",
  DD: "Double",
  sidelite: "Sidelite",
};

/**
 * Derives a "family" code from a design code. Examples:
 *   ID01-SD  → ID01
 *   ID01-DD  → ID01
 *   TD-SD-W06 → TD-W06
 *   TD-DED-B01 → TD-DED-B01
 *
 * Heuristic: strip the door-type token (SD|DD|sidelite) when it appears
 * surrounded by hyphens, keeping the rest. If the code doesn't match a
 * known pattern, the family equals the code itself (a singleton family).
 */
function familyOf(code: string): string {
  return code
    .replace(/-(SD|DD|sidelite)(?=-|$)/i, "")
    .toUpperCase();
}

export default function CatalogPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Pull ALL designs in one shot so we can group by family client-side.
  // 200 is a safe cap (the catalog has 33 today).
  const designs = useQuery<{ records: Design[]; total: number }>({
    queryKey: ["catalog-designs", debouncedQ],
    queryFn: () => {
      const url = new URL("/api/catalog/designs", window.location.origin);
      if (debouncedQ) url.searchParams.set("q", debouncedQ);
      url.searchParams.set("limit", "500");
      return fetch(url).then((r) => r.json());
    },
  });

  const dealers = useQuery<{ records: Dealer[] }>({
    queryKey: ["catalog-dealers"],
    queryFn: () => fetch("/api/catalog/dealers").then((r) => r.json()),
  });

  const brands = useQuery<{ records: Brand[] }>({
    queryKey: ["catalog-brands"],
    queryFn: () => fetch("/api/catalog/brands?archived=1").then((r) => r.json()),
  });

  // Group designs by family.
  const families = useMemo(() => {
    const map = new Map<string, Design[]>();
    for (const d of designs.data?.records ?? []) {
      const f = familyOf(d.code);
      if (!map.has(f)) map.set(f, []);
      map.get(f)!.push(d);
    }
    return [...map.entries()]
      .map(([family, variants]) => ({
        family,
        variants: variants.sort((a, b) => a.code.localeCompare(b.code)),
      }))
      .sort((a, b) => a.family.localeCompare(b.family));
  }, [designs.data]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Catalog
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Dealers, brands and the catalog of door designs.
          </p>
        </div>
      </header>

      {/* ---------- Dealers ---------- */}
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-indigo-700" />
            <h2 className="font-semibold text-slate-800">
              Dealers ({dealers.data?.records.length ?? 0})
            </h2>
          </div>
          <Link
            href="/catalog/dealers/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-indigo-700 px-4 text-sm font-semibold text-white shadow shadow-indigo-700/30 transition hover:bg-indigo-800"
          >
            <Plus size={14} />
            New dealer
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(dealers.data?.records ?? []).map((d) => (
            <Link
              key={d.id}
              href={`/catalog/dealers/${d.id}`}
              className="flex items-center justify-between rounded-xl border border-slate-100 p-4 transition hover:border-indigo-200 hover:bg-indigo-50/30"
            >
              <div>
                <div className="font-bold uppercase text-indigo-700">{d.name}</div>
                <div className="text-xs text-slate-500">
                  Default: {fmtMoney(d.indigo_default_price_per_sqf)} / SQF
                </div>
              </div>
              <Pencil size={14} className="text-slate-400" />
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Brands ---------- */}
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Tag size={18} className="text-indigo-700" />
            <h2 className="font-semibold text-slate-800">
              Brands ({brands.data?.records.length ?? 0})
            </h2>
          </div>
          <Link
            href="/catalog/brands/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-indigo-700 px-4 text-sm font-semibold text-white shadow shadow-indigo-700/30 transition hover:bg-indigo-800"
          >
            <Plus size={14} />
            New brand
          </Link>
        </div>
        <p className="-mt-2 mb-3 text-xs text-slate-500">
          Window / door brands that interfere with the paint type. Mario picks
          the brand when entering measurements.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {(brands.data?.records ?? []).map((b) => (
            <Link
              key={b.id}
              href={`/catalog/brands/${b.id}`}
              className="flex items-center justify-between rounded-xl border border-slate-100 p-3 transition hover:border-indigo-200 hover:bg-indigo-50/30"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">
                  {b.name}
                </div>
                {b.code && (
                  <div className="text-[10px] font-mono uppercase text-slate-400">
                    {b.code}
                  </div>
                )}
              </div>
              {b.active === false && (
                <Badge variant="secondary" className="bg-amber-50 text-amber-700">
                  Archived
                </Badge>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Designs grouped by family ---------- */}
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Boxes size={18} className="text-indigo-700" />
            <h2 className="font-semibold text-slate-800">
              Designs ({designs.data?.records?.length ?? 0})
              <span className="ml-1.5 text-xs font-normal text-slate-400">
                · {families.length} {families.length === 1 ? "family" : "families"}
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by code or name…"
                className="pl-9"
              />
            </div>
            <Link
              href="/catalog/designs/new"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-indigo-700 px-4 text-sm font-semibold text-white shadow shadow-indigo-700/30 transition hover:bg-indigo-800"
            >
              <Plus size={14} />
              New design
            </Link>
          </div>
        </div>

        {/* Family list */}
        <div className="space-y-2">
          {families.map(({ family, variants }) => (
            <FamilyRow key={family} family={family} variants={variants} />
          ))}
          {families.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-8 text-center text-sm text-slate-400">
              No designs match the filter.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Collapsible family row that lists all variants underneath.
 *
 * "Variant" = a concrete `indigo.design` record with its own door_type and
 * therefore its own production specs. A family like ID01 may have ID01-SD
 * and ID01-DD as variants. Each variant has its own image too.
 */
function FamilyRow({
  family,
  variants,
}: {
  family: string;
  variants: Design[];
}) {
  const [open, setOpen] = useState(false);
  // Auto-open singletons (families with a single variant) — there's nothing
  // to expand, so showing the variant directly avoids a useless click.
  const isSingleton = variants.length === 1;
  const shouldShow = open || isSingleton;
  const types = [...new Set(variants.map((v) => v.door_type).filter(Boolean))];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100">
      <button
        type="button"
        onClick={() => !isSingleton && setOpen((v) => !v)}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
          isSingleton ? "cursor-default" : "hover:bg-slate-50"
        }`}
      >
        {!isSingleton && (
          <ChevronRight
            size={14}
            className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
          />
        )}
        <div className="flex flex-1 items-baseline gap-3">
          <span className="font-mono font-bold text-indigo-700">{family}</span>
          <span className="text-xs text-slate-400">
            {variants.length} {variants.length === 1 ? "variant" : "variants"}
          </span>
          {types.length > 0 && (
            <span className="flex gap-1">
              {types.map((t) => (
                <Badge
                  key={t}
                  variant="secondary"
                  className="bg-indigo-50 text-[10px] uppercase text-indigo-700"
                >
                  {DOOR_TYPE_LABEL[t as string] ?? t}
                </Badge>
              ))}
            </span>
          )}
        </div>
      </button>

      {shouldShow && (
        <div
          className={`divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/30 ${
            isSingleton ? "" : ""
          }`}
        >
          {variants.map((v) => (
            <Link
              key={v.id}
              href={`/catalog/designs/${v.id}`}
              className="flex items-center gap-3 px-6 py-2.5 text-sm transition hover:bg-indigo-50/30"
            >
              <span className="font-mono font-bold text-indigo-700">
                {v.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-700">
                {v.name}
              </span>
              {v.door_type && (
                <Badge
                  variant="secondary"
                  className="bg-white text-slate-600"
                >
                  {DOOR_TYPE_LABEL[v.door_type] ?? v.door_type}
                </Badge>
              )}
              {v.active === false && (
                <Badge variant="secondary" className="bg-amber-50 text-amber-700">
                  Archived
                </Badge>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
