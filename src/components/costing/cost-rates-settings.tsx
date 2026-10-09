"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Save } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CostRate } from "@/lib/costing/types";

/**
 * Settings → Cost per door: the fixed rates the estimate of each order is
 * made with (Majela, 9-oct-2026). Saved on its own, apart from the page's
 * main Save.
 */
export function CostRatesSettings() {
  const qc = useQueryClient();
  const q = useQuery<{ data: CostRate[] }>({
    queryKey: ["cost-rates"],
    queryFn: () => fetchJson("/api/costing/settings"),
    retry: 1,
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const rates = q.data?.data;

  useEffect(() => {
    // Fill the boxes once the saved values arrive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (rates) setDraft(Object.fromEntries(rates.map((r) => [r.key, String(r.value)])));
  }, [rates]);

  if (q.isError) {
    return (
      <section id="cost-rates" className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Calculator size={16} className="text-indigo-700" /> Cost per door
        </h2>
        <p className="mt-2 text-sm text-rose-700">
          Couldn&apos;t load the cost rates{q.error instanceof Error ? `: ${q.error.message}` : ""}.{" "}
          <button type="button" onClick={() => q.refetch()} className="font-semibold underline">
            Try again
          </button>
        </p>
      </section>
    );
  }
  if (!rates) return null;
  const dirty = rates.some((r) => Number(draft[r.key]) !== r.value);

  async function save() {
    const body: Record<string, number> = {};
    for (const r of rates ?? []) {
      const raw = (draft[r.key] ?? "").trim();
      const n = Number(raw);
      // Una casilla vacia no es 0: guardaria todos los costos de menos.
      if (!raw || !Number.isFinite(n) || n < 0 || (r.key === "acm_sheet_sqf" && n <= 0)) {
        toast.error(`${r.label}: write a number${r.key === "acm_sheet_sqf" ? " above 0" : ""}.`);
        return;
      }
      body[r.key] = n;
    }
    setBusy(true);
    try {
      const res = await fetchJson<{ data: CostRate[] }>("/api/costing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      qc.setQueryData(["cost-rates"], res);
      qc.invalidateQueries({ queryKey: ["order-cost"] });
      qc.invalidateQueries({ queryKey: ["invoice-profit"] });
      qc.invalidateQueries({ queryKey: ["cost-month"] });
      toast.success("Cost rates saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="cost-rates" className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Calculator size={16} className="text-indigo-700" /> Cost per door
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            The estimated cost on each order is made with these rates, plus the painting and digitization already
            paid. The real month (purchase bills and pay) is in Billing → Costs, to check these numbers.
          </p>
        </div>
        <Button type="button" onClick={save} disabled={!dirty || busy}>
          <Save size={14} /> {busy ? "Saving…" : dirty ? "Save rates" : "Saved"}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rates.map((r) => (
          <label key={r.key} htmlFor={`cost-${r.key}`} className="block text-xs text-slate-600">
            {r.label}
            <div className="mt-1 flex items-center gap-1">
              {r.key !== "acm_sheet_sqf" && <span className="text-slate-400">$</span>}
              <Input
                id={`cost-${r.key}`}
                type="number"
                min={0}
                step={0.01}
                value={draft[r.key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                className="tabular-nums"
              />
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}
