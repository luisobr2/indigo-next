"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DollarSign, Search, Save, Info } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MatrixRow {
  id: number;
  door_type: string;
  tier: string;
  price: number;
  active: boolean;
}
interface DesignRow {
  id: number;
  code: string;
  name: string | false;
  door_type: string | false;
  dealer_price_override: number;
}
interface PricingData {
  matrix: MatrixRow[];
  designs: DesignRow[];
}

const DOOR_LABEL: Record<string, string> = {
  SD: "Single Door",
  DD: "Double Door",
  sidelite: "Door with Sidelites",
};

export default function PricingPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<PricingData>({
    queryKey: ["pricing"],
    queryFn: () => fetchJson<PricingData>("/api/pricing"),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  // ---- Base price editor (the "basic" row per door type) ----
  const baseRows = useMemo(
    () => (data?.matrix ?? []).filter((r) => r.tier === "basic"),
    [data?.matrix],
  );
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [savingBase, setSavingBase] = useState(false);
  const baseSig = baseRows.map((r) => r.id).join(",");
  useEffect(() => {
    const d: Record<number, string> = {};
    for (const r of baseRows) d[r.id] = String(r.price ?? 0);
    setDraft(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSig]);

  const dirty = baseRows.some(
    (r) => String(r.price) !== (draft[r.id] ?? String(r.price)),
  );

  // Live base price for a door type (from the draft), for design placeholders.
  const basePriceOf = (dt: string | false) => {
    if (!dt) return null;
    const r = baseRows.find((x) => x.door_type === dt);
    if (!r) return null;
    const v = parseFloat(draft[r.id] ?? String(r.price));
    return Number.isFinite(v) ? v : r.price;
  };

  async function saveBase() {
    const rows = baseRows
      .map((r) => ({ id: r.id, price: parseFloat(draft[r.id] ?? "") }))
      .filter((r) => Number.isFinite(r.price));
    setSavingBase(true);
    try {
      await fetchJson("/api/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      toast.success("Base prices saved");
      qc.invalidateQueries({ queryKey: ["pricing"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save prices");
    } finally {
      setSavingBase(false);
    }
  }

  // ---- Per-design own price (override), auto-saved on blur ----
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [savingId, setSavingId] = useState<number | null>(null);
  // Local text draft per design + optimistic saved override.
  const [ovDraft, setOvDraft] = useState<Record<number, string>>({});
  const [ovSaved, setOvSaved] = useState<Record<number, number>>({});

  const designs = data?.designs ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return designs.filter((d) => {
      if (typeFilter !== "all" && (d.door_type || "") !== typeFilter) return false;
      if (!needle) return true;
      return (
        d.code.toLowerCase().includes(needle) ||
        (d.name || "").toLowerCase().includes(needle)
      );
    });
  }, [designs, q, typeFilter]);

  const overrideOf = (d: DesignRow) => ovSaved[d.id] ?? d.dealer_price_override ?? 0;
  const draftValue = (d: DesignRow) => {
    if (d.id in ovDraft) return ovDraft[d.id];
    const ov = overrideOf(d);
    return ov > 0 ? String(ov) : "";
  };

  async function saveOverride(d: DesignRow) {
    const raw = ovDraft[d.id];
    if (raw === undefined) return; // not edited
    const parsed = raw.trim() === "" ? 0 : parseFloat(raw);
    const value = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
    if (value === overrideOf(d)) {
      // no change — just drop the draft
      setOvDraft((m) => {
        const n = { ...m };
        delete n[d.id];
        return n;
      });
      return;
    }
    setSavingId(d.id);
    try {
      await fetchJson(`/api/pricing/design/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealer_price_override: value }),
      });
      setOvSaved((m) => ({ ...m, [d.id]: value }));
      setOvDraft((m) => {
        const n = { ...m };
        delete n[d.id];
        return n;
      });
      toast.success(
        value > 0 ? `${d.code} → $${value.toLocaleString()}` : `${d.code} → base price`,
      );
      qc.invalidateQueries({ queryKey: ["pricing"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save price");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <DollarSign className="text-indigo-700" size={26} />
          Pricing
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Base price charged to dealers per door type. Optionally give a specific
          design its own price. This is what dealers see on the catalog and what
          new orders are billed.
        </p>
      </div>

      {isLoading && (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      )}
      {isError && (
        <div className="py-16 text-center text-sm text-rose-600">
          Couldn&apos;t load pricing. Refresh to try again.
        </div>
      )}

      {data && (
        <>
          {/* Base price per door type */}
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800">Base price</h2>
                <p className="text-xs text-slate-500">
                  The standard price every design of that door type uses.
                </p>
              </div>
              <Button
                size="lg"
                onClick={saveBase}
                disabled={!dirty || savingBase}
                className="bg-indigo-700 text-white hover:bg-indigo-800 disabled:opacity-40"
              >
                <Save size={15} />
                {savingBase ? "Saving…" : "Save"}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {baseRows.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                >
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {DOOR_LABEL[r.door_type] ?? r.door_type}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-lg font-bold text-slate-400">$</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={draft[r.id] ?? ""}
                      onChange={(e) =>
                        setDraft((m) => ({ ...m, [r.id]: e.target.value }))
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 px-2 text-lg font-bold text-slate-800 focus:border-indigo-400 focus:outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Per-design own price */}
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800">Special design prices</h2>
                <p className="text-xs text-slate-500">
                  Optional. Give a design its own price. Leave blank to use the
                  base price. Saves when you click away.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search code…"
                    className="h-9 w-44 rounded-lg border border-slate-200 pl-8 pr-2 text-sm focus:border-indigo-400 focus:outline-none"
                  />
                </div>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-indigo-400 focus:outline-none"
                >
                  <option value="all">All types</option>
                  <option value="SD">Single</option>
                  <option value="DD">Double</option>
                  <option value="sidelite">Sidelites</option>
                </select>
              </div>
            </div>

            <div className="mb-2 flex items-start gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>
                {filtered.length} design{filtered.length === 1 ? "" : "s"}. Blank =
                uses the base price shown next to each.
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {filtered.map((d) => {
                const base = basePriceOf(d.door_type);
                const ov = overrideOf(d);
                return (
                  <div key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-800">{d.code}</span>
                      {d.name && (
                        <span className="ml-2 text-sm text-slate-400">{d.name}</span>
                      )}
                      <span className="ml-2 text-xs text-slate-400">
                        {d.door_type ? DOOR_LABEL[d.door_type] ?? d.door_type : "—"}
                      </span>
                    </div>
                    <div className="w-28 text-right text-xs text-slate-400">
                      base {base != null ? `$${base.toLocaleString()}` : "—"}
                    </div>
                    <div
                      className={cn(
                        "flex items-center gap-1 rounded-lg border px-2",
                        ov > 0 ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white",
                        savingId === d.id && "opacity-50",
                      )}
                    >
                      <span className="text-slate-400">$</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        disabled={savingId === d.id}
                        value={draftValue(d)}
                        placeholder={base != null ? String(base) : ""}
                        onChange={(e) =>
                          setOvDraft((m) => ({ ...m, [d.id]: e.target.value }))
                        }
                        onBlur={() => saveOverride(d)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        className="h-9 w-24 bg-transparent text-right text-sm font-semibold text-indigo-800 focus:outline-none"
                      />
                    </div>
                  </div>
                );
              })}
              {!filtered.length && (
                <div className="py-10 text-center text-sm text-slate-400">
                  No designs match.
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
