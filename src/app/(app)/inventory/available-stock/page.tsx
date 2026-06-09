"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Package, Search, Calendar, Clock, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fmtDate, fmtNum, m2o } from "@/lib/utils";

interface StockRecord {
  id: number;
  name: string;
  stock_label: string;
  stock_at: string | false;
  stock_reason: string;
  original_client_name: string;
  dealer_id: [number, string] | false;
  total_sqf: number;
  door_count: number;
  create_date: string;
  first_line?: {
    id: number;
    design_id: [number, string] | false;
    door_type?: string;
    color?: string;
    glass_type?: string;
    glass_privacy?: string;
    material?: string;
    thickness?: string;
    width?: number;
    height?: number;
    width_label?: string;
    height_label?: string;
  } | null;
}

const COLOR_DOT: Record<string, string> = {
  white: "#fff",
  bronze: "#a16207",
  bronze_eco: "#854d0e",
  black: "#111",
};

const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "Single Door",
  DD: "Double Door",
  SDL: "Door with Sidelites",
};

function daysSince(iso: string | false): number {
  if (!iso) return 0;
  const t = new Date(iso.replace(" ", "T") + "Z").getTime();
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 3600 * 1000)));
}

export default function AvailableStockPage() {
  const [q, setQ] = useState("");
  const [doorType, setDoorType] = useState("");
  const [color, setColor] = useState("");
  const [material, setMaterial] = useState("");

  const { data, isLoading } = useQuery<{ records: StockRecord[] }>({
    queryKey: ["inventory-available", q, doorType, color, material],
    queryFn: () => {
      const url = new URL("/api/inventory/available", window.location.origin);
      if (q) url.searchParams.set("q", q);
      if (doorType) url.searchParams.set("door_type", doorType);
      if (color) url.searchParams.set("color", color);
      if (material) url.searchParams.set("material", material);
      return fetch(url).then((r) => r.json());
    },
  });

  const records = data?.records ?? [];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <Package size={28} className="text-indigo-700" />
            Available Stock
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Finished doors held in the warehouse, ready to fulfil a new order
            with matching characteristics. New orders see a banner when a
            match is found.
          </p>
        </div>
        <div className="rounded-2xl bg-indigo-50 px-4 py-2 text-sm">
          <span className="text-indigo-700/70">Doors available: </span>
          <span className="font-bold text-indigo-900">{fmtNum(records.length)}</span>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
        <div className="relative flex-1 min-w-[260px]">
          <Search
            size={16}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
          />
          <Input
            type="search"
            placeholder="Search nickname, original client, order #..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-10"
          />
        </div>
        <FilterPill
          label="Door type"
          value={doorType}
          onChange={setDoorType}
          options={[
            { value: "", label: "Any" },
            { value: "SD", label: "Single" },
            { value: "DD", label: "Double" },
            { value: "SDL", label: "With Sidelites" },
          ]}
        />
        <FilterPill
          label="Color"
          value={color}
          onChange={setColor}
          options={[
            { value: "", label: "Any" },
            { value: "white", label: "White" },
            { value: "bronze", label: "Bronze" },
            { value: "bronze_eco", label: "Bronze ECO" },
            { value: "black", label: "Black" },
          ]}
        />
        <FilterPill
          label="Material"
          value={material}
          onChange={setMaterial}
          options={[
            { value: "", label: "Any" },
            { value: "acm_white", label: "ACM White" },
            { value: "acm_black", label: "ACM Black" },
            { value: "acm_bronze", label: "ACM Bronze" },
          ]}
        />
      </div>

      {/* Empty state */}
      {!isLoading && records.length === 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center shadow-sm">
          <Package size={36} className="mx-auto mb-3 text-slate-300" />
          <h3 className="font-semibold text-slate-700">No stock available</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            When an order is cancelled after the door is cut or painted, the
            finished door is held here for re-use. Right now there are no
            doors in stock.
          </p>
        </div>
      )}

      {/* Card grid */}
      {records.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {records.map((r) => {
            const designId =
              r.first_line?.design_id && Array.isArray(r.first_line.design_id)
                ? r.first_line.design_id[0]
                : null;
            const designLabel =
              r.first_line?.design_id && Array.isArray(r.first_line.design_id)
                ? r.first_line.design_id[1]
                : "—";
            const days = daysSince(r.stock_at);
            return (
              <article
                key={r.id}
                className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 transition hover:shadow-md hover:ring-indigo-200"
              >
                <div className="aspect-square overflow-hidden bg-slate-50">
                  {designId ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/catalog/designs/${designId}/image`}
                      alt={designLabel}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-slate-300">
                      No image
                    </div>
                  )}
                </div>
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-slate-800 leading-tight">
                      {r.stock_label || "(no nickname)"}
                    </h3>
                    <span className="flex flex-none items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      <Clock size={9} /> {days}d
                    </span>
                  </div>
                  <div className="font-mono text-xs font-semibold text-indigo-700">
                    {designLabel}
                  </div>
                  <ul className="space-y-1 text-xs text-slate-600">
                    <li className="flex items-center justify-between">
                      <span className="text-slate-400">Type</span>
                      <span>{DOOR_TYPE_LABEL[r.first_line?.door_type ?? ""] ?? "—"}</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="text-slate-400">Color</span>
                      <span className="flex items-center gap-1.5 capitalize">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full border border-slate-300"
                          style={{ background: COLOR_DOT[r.first_line?.color ?? ""] ?? "#cbd5e1" }}
                        />
                        {r.first_line?.color?.replace("_", " ") ?? "—"}
                      </span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="text-slate-400">Dimensions</span>
                      <span className="font-mono">
                        {r.first_line?.width_label || r.first_line?.width || "?"}
                        ″ × {r.first_line?.height_label || r.first_line?.height || "?"}″
                      </span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="text-slate-400">Glass</span>
                      <span>{r.first_line?.glass_type || "—"}</span>
                    </li>
                    {(r.first_line?.material || r.first_line?.thickness) && (
                      <li className="flex items-center justify-between">
                        <span className="text-slate-400">Material</span>
                        <span>
                          {r.first_line?.material?.replace("_", " ") || "—"}
                          {r.first_line?.thickness ? ` · ${r.first_line.thickness}` : ""}
                        </span>
                      </li>
                    )}
                  </ul>
                  <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                    <div className="flex items-center gap-1">
                      <Calendar size={10} className="text-slate-400" />
                      In stock since {fmtDate(r.stock_at as string)}
                    </div>
                    <div className="truncate">
                      Originally for{" "}
                      <span className="font-medium text-slate-700">
                        {r.original_client_name || "—"}
                      </span>{" "}
                      ({m2o(r.dealer_id)?.name ?? "—"})
                    </div>
                    <div className="truncate text-slate-400">From {r.name}</div>
                  </div>
                  <Link
                    href={`/orders/${r.id}`}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline"
                  >
                    Open order detail
                    <ArrowRight size={11} />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm focus:border-indigo-400 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {label}: {o.label}
        </option>
      ))}
    </select>
  );
}
