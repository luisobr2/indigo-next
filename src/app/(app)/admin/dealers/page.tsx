"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Power, Printer } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { sortRows } from "@/hooks/use-table-prefs";
import { printTable } from "@/lib/print-table";
import { Button } from "@/components/ui/button";

interface Dealer {
  id: number;
  name: string;
  email: string | false;
  phone: string | false;
  city: string | false;
  indigo_default_price_per_sqf: number;
  active: boolean;
}

export default function DealersAdminPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<{ records: Dealer[] }>({
    queryKey: ["admin-dealers"],
    queryFn: () => fetchJson<{ records: Dealer[] }>("/api/catalog/dealers?all=1"),
    retry: 1,
  });
  const dealers = data?.records ?? [];

  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const SORT_VAL: Record<string, (d: Dealer) => string | number> = {
    name: (d) => (d.name || "").toLowerCase(),
    email: (d) => String(d.email || "").toLowerCase(),
    phone: (d) => String(d.phone || ""),
    city: (d) => String(d.city || "").toLowerCase(),
    status: (d) => (d.active ? 0 : 1),
  };
  function toggleSort(key: string) {
    setSort((p) =>
      !p || p.key !== key ? { key, dir: "asc" } : p.dir === "asc" ? { key, dir: "desc" } : null,
    );
  }
  const sortedDealers = useMemo(
    () => (sort && SORT_VAL[sort.key] ? sortRows(dealers, SORT_VAL[sort.key], sort.dir) : dealers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dealers, sort],
  );

  function printList() {
    if (!sortedDealers.length) return toast.warning("Nothing to print");
    const ok = printTable({
      title: "Indigo Decors — Dealers",
      subtitle: `${sortedDealers.length} dealer${sortedDealers.length === 1 ? "" : "s"} · ${new Date().toLocaleString()}`,
      rows: sortedDealers,
      columns: [
        { label: "Name", print: (d) => d.name },
        { label: "Email", print: (d) => String(d.email || "") },
        { label: "Phone", print: (d) => String(d.phone || "") },
        { label: "City", print: (d) => String(d.city || "") },
        { label: "Status", print: (d) => (d.active ? "Active" : "Inactive") },
      ],
    });
    if (!ok) toast.error("Allow pop-ups to print the list");
  }

  function toggleActive(d: Dealer) {
    const verb = d.active ? "Deactivate" : "Reactivate";
    if (!window.confirm(`${verb} ${d.name}?`)) return;
    const p = fetch(`/api/catalog/dealers/${d.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !d.active }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["admin-dealers"] });
      qc.invalidateQueries({ queryKey: ["catalog-dealers"] });
      return j;
    });
    toast.promise(p, {
      loading: "Saving…",
      success: `${d.name} ${d.active ? "deactivated" : "reactivated"}`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 size={28} className="text-indigo-700" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Dealers</h1>
            <p className="text-sm text-slate-500">Companies that place orders.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="lg" onClick={printList}>
            <Printer size={14} /> Print list
          </Button>
          <Link href="/catalog/dealers/new">
            <Button size="lg"><Plus size={14} /> New dealer</Button>
          </Link>
        </div>
      </div>

      {isLoading && <div className="p-12 text-center text-slate-400">Loading…</div>}
      {isError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700">
          Couldn&apos;t load dealers.{" "}
          <button className="underline" onClick={() => refetch()}>Retry</button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                {[
                  { key: "name", label: "Name" },
                  { key: "email", label: "Email" },
                  { key: "phone", label: "Phone" },
                  { key: "city", label: "City" },
                  { key: "status", label: "Status" },
                ].map((h) => (
                  <th key={h.key} className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort(h.key)}
                      className="inline-flex items-center gap-1 uppercase hover:text-slate-900"
                    >
                      {h.label}
                      {sort?.key === h.key && <span>{sort.dir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedDealers.map((d) => (
                <tr key={d.id} className={`border-b border-slate-50 last:border-0 ${d.active ? "" : "opacity-50"}`}>
                  <td className="px-4 py-3 font-medium text-indigo-700">
                    <Link href={`/catalog/dealers/${d.id}`} className="hover:underline">{d.name}</Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{(d.email as string) || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{(d.phone as string) || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{(d.city as string) || "—"}</td>
                  <td className="px-4 py-3">
                    {d.active ? <span className="text-emerald-700">Active</span> : <span className="text-slate-400">Inactive</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button title={d.active ? "Deactivate" : "Reactivate"} onClick={() => toggleActive(d)}
                      className={`rounded-lg p-1.5 hover:bg-slate-100 ${d.active ? "text-slate-500 hover:text-rose-700" : "text-emerald-600"}`}>
                      <Power size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {dealers.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No dealers.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
