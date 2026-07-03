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
  dealer_tier: string;
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
const TIER_LABEL: Record<string, string> = {
  basic: "Basic",
  full_partial: "Full / Partial",
};
const TIER_ORDER = ["basic", "full_partial"];

export default function PricingPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<PricingData>({
    queryKey: ["pricing"],
    queryFn: () => fetchJson<PricingData>("/api/pricing"),
    // Editing screen — don't refetch under the user mid-edit.
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  // ---- Matrix editor (draft prices keyed by row id) ----
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [savingMatrix, setSavingMatrix] = useState(false);
  // Seed the draft only when the SET of rows changes (first load), not on
  // every refetch — otherwise a background refetch (e.g. window refocus)
  // would wipe the user's unsaved edits. After a save the values already
  // match the server, so not re-seeding is correct.
  const matrixSig = (data?.matrix ?? []).map((r) => r.id).join(",");
  useEffect(() => {
    const rows = data?.matrix ?? [];
    const d: Record<number, string> = {};
    for (const r of rows) d[r.id] = String(r.price ?? 0);
    setDraft(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrixSig]);

  const matrix = data?.matrix ?? [];
  const doorTypes = useMemo(
    () => [...new Set(matrix.map((r) => r.door_type))],
    [matrix],
  );
  const cell = (dt: string, tier: string) =>
    matrix.find((r) => r.door_type === dt && r.tier === tier);

  const dirty = matrix.some((r) => String(r.price) !== (draft[r.id] ?? String(r.price)));

  async function saveMatrix() {
    const rows = matrix
      .map((r) => ({ id: r.id, price: parseFloat(draft[r.id] ?? "") }))
      .filter((r) => Number.isFinite(r.price));
    setSavingMatrix(true);
    try {
      await fetchJson("/api/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      toast.success("Prices saved");
      qc.invalidateQueries({ queryKey: ["pricing"] });
      qc.invalidateQueries({ queryKey: ["catalog-families"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save prices");
    } finally {
      setSavingMatrix(false);
    }
  }

  // Price for a (door_type, tier) from the CURRENT draft, for live previews.
  const priceOf = (dt: string | false, tier: string) => {
    if (!dt) return null;
    const c = cell(dt, tier);
    if (!c) return null;
    const v = parseFloat(draft[c.id] ?? String(c.price));
    return Number.isFinite(v) ? v : c.price;
  };

  // ---- Designs list (per-design tier, auto-saved) ----
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [savingId, setSavingId] = useState<number | null>(null);
  // Optimistic local tier overrides so a toggle reflects immediately.
  const [tierOverride, setTierOverride] = useState<Record<number, string>>({});

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

  async function setTier(d: DesignRow, tier: string) {
    setSavingId(d.id);
    setTierOverride((m) => ({ ...m, [d.id]: tier }));
    try {
      await fetchJson(`/api/pricing/design/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealer_tier: tier }),
      });
      toast.success(`${d.code} → ${TIER_LABEL[tier]}`);
      qc.invalidateQueries({ queryKey: ["pricing"] });
      qc.invalidateQueries({ queryKey: ["catalog-families"] });
    } catch (e) {
      setTierOverride((m) => {
        const n = { ...m };
        delete n[d.id];
        return n;
      });
      toast.error(e instanceof Error ? e.message : "Couldn't update tier");
    } finally {
      setSavingId(null);
    }
  }
  const tierOf = (d: DesignRow) => tierOverride[d.id] ?? d.dealer_tier;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <DollarSign className="text-indigo-700" size={26} />
          Pricing
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Base price charged to dealers per door. This is what logged-in dealers
          see on the catalog and what new orders are billed at.
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
          {/* Base price matrix */}
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800">Base prices</h2>
                <p className="text-xs text-slate-500">
                  Two levels per door type. Assign each design to a level below.
                </p>
              </div>
              <Button
                size="lg"
                onClick={saveMatrix}
                disabled={!dirty || savingMatrix}
                className="bg-indigo-700 text-white hover:bg-indigo-800 disabled:opacity-40"
              >
                <Save size={15} />
                {savingMatrix ? "Saving…" : "Save prices"}
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2 font-semibold">Door type</th>
                    {TIER_ORDER.map((t) => (
                      <th key={t} className="px-3 py-2 font-semibold">
                        {TIER_LABEL[t]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {doorTypes.map((dt) => (
                    <tr key={dt} className="border-t border-slate-100">
                      <td className="px-3 py-3 font-medium text-slate-800">
                        {DOOR_LABEL[dt] ?? dt}
                      </td>
                      {TIER_ORDER.map((t) => {
                        const c = cell(dt, t);
                        return (
                          <td key={t} className="px-3 py-3">
                            {c ? (
                              <div className="flex items-center gap-1">
                                <span className="text-slate-400">$</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={draft[c.id] ?? ""}
                                  onChange={(e) =>
                                    setDraft((m) => ({ ...m, [c.id]: e.target.value }))
                                  }
                                  className="h-9 w-28 rounded-lg border border-slate-200 px-2 text-sm focus:border-indigo-400 focus:outline-none"
                                />
                              </div>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Per-design tier */}
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800">Design price level</h2>
                <p className="text-xs text-slate-500">
                  Mark elaborate designs as Full / Partial to charge the higher
                  price. Saves as you toggle.
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
                {filtered.length} design{filtered.length === 1 ? "" : "s"}. The
                price shown is the base for that door type at the chosen level.
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {filtered.map((d) => {
                const tier = tierOf(d);
                const price = priceOf(d.door_type, tier);
                return (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center gap-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-800">{d.code}</span>
                      {d.name && (
                        <span className="ml-2 text-sm text-slate-400">{d.name}</span>
                      )}
                      <span className="ml-2 text-xs text-slate-400">
                        {d.door_type ? DOOR_LABEL[d.door_type] ?? d.door_type : "—"}
                      </span>
                    </div>
                    <div className="w-20 text-right font-bold text-indigo-700">
                      {price != null ? `$${price.toLocaleString()}` : "—"}
                    </div>
                    <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
                      {TIER_ORDER.map((t) => (
                        <button
                          key={t}
                          type="button"
                          disabled={savingId === d.id || tier === t || !d.door_type}
                          onClick={() => setTier(d, t)}
                          className={cn(
                            "px-3 py-1.5 text-xs font-semibold transition",
                            tier === t
                              ? "bg-indigo-700 text-white"
                              : "bg-white text-slate-600 hover:bg-slate-50",
                            (savingId === d.id || !d.door_type) && "opacity-50",
                          )}
                        >
                          {TIER_LABEL[t]}
                        </button>
                      ))}
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
