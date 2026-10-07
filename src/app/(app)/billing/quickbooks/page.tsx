"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/skeleton";
import { ErrorState } from "@/components/state-cards";
import type { QboStatus } from "@/components/billing/quickbooks-settings";

interface MappingRow {
  id: number;
  name?: string;
  code?: string;
  label?: string;
  taxable?: boolean;
  qbo_id: string | false;
  qbo_name: string | false;
}
interface Mappings {
  dealers: MappingRow[];
  products: MappingRow[];
}
interface Remote {
  id: string;
  name: string;
}
type Kind = "dealer" | "product";

/**
 * Billing → QuickBooks: which QuickBooks customer is each dealer, and which
 * QuickBooks product is each invoice product. An invoice can't go to
 * QuickBooks until its dealer and its products are matched.
 */
export default function QuickBooksMappingsPage() {
  const qc = useQueryClient();
  const statusQ = useQuery<{ data: QboStatus } | null>({
    queryKey: ["qbo-status"],
    queryFn: async () => {
      const res = await fetch("/api/quickbooks/status");
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error("Couldn't load QuickBooks");
      return res.json();
    },
    retry: false,
  });
  const connected = !!statusQ.data?.data.connected;
  const mapQ = useQuery<{ data: Mappings }>({
    queryKey: ["qbo-mappings"],
    queryFn: () => fetchJson("/api/quickbooks/mappings"),
    enabled: connected,
  });
  const customersQ = useQboRemote("customers", connected);
  const itemsQ = useQboRemote("items", connected);
  const accountsQ = useQboRemote("accounts", connected);
  const [busy, setBusy] = useState<string | null>(null);
  const [account, setAccount] = useState("");

  async function post(body: Record<string, unknown>, key: string, ok?: string) {
    setBusy(key);
    try {
      const r = await fetchJson<{ data: unknown }>("/api/quickbooks/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (ok) toast.success(ok);
      qc.invalidateQueries({ queryKey: ["qbo-mappings"] });
      qc.invalidateQueries({ queryKey: ["qbo-remote"] });
      return r.data;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function auto() {
    const res = (await post({ action: "auto" }, "auto")) as {
      matched: { dealers: number; products: number };
      missing: { dealers: string[]; products: string[] };
    } | null;
    if (!res) return;
    const left = res.missing.dealers.length + res.missing.products.length;
    toast.success(
      `Matched ${res.matched.dealers} dealer${res.matched.dealers === 1 ? "" : "s"} and ${res.matched.products} product${res.matched.products === 1 ? "" : "s"}.` +
        (left ? ` ${left} still need a match.` : " Everything is matched."),
      { duration: 8000 },
    );
  }

  if (statusQ.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (!statusQ.data) {
    return <ErrorState title="QuickBooks isn't available" message="It isn't installed on this server yet." backHref="/billing" />;
  }
  if (!connected) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">QuickBooks matching</h1>
        <p className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-sm ring-1 ring-slate-100">
          QuickBooks isn&apos;t connected. A manager can connect it in{" "}
          <Link href="/settings#quickbooks" className="font-medium text-indigo-700 hover:underline">
            Settings → QuickBooks
          </Link>
          .
        </p>
      </div>
    );
  }
  if (mapQ.error) {
    return <ErrorState title="Couldn't load the matches" message={mapQ.error instanceof Error ? mapQ.error.message : undefined} onRetry={() => mapQ.refetch()} />;
  }
  const m = mapQ.data?.data;
  const unmatched = m ? m.dealers.filter((d) => !d.qbo_id).length + m.products.filter((p) => !p.qbo_id).length : 0;

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">QuickBooks matching</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Each dealer is a customer in QuickBooks, and each invoice line uses a QuickBooks product. An invoice
            only goes to QuickBooks once its dealer and products are matched.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/billing" className="text-sm font-medium text-indigo-700 hover:underline">
            ← Billing
          </Link>
          <Button onClick={auto} disabled={busy !== null || !m}>
            <Wand2 size={14} /> {busy === "auto" ? "Matching…" : "Match automatically"}
          </Button>
        </div>
      </header>

      {m && (
        <p
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2 text-sm",
            unmatched ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800",
          )}
        >
          {unmatched ? <CircleAlert size={15} /> : <CheckCircle2 size={15} />}
          {unmatched
            ? `${unmatched} still need a match. "Match automatically" pairs the ones with the same name; choose or create the rest.`
            : "Everything is matched."}
        </p>
      )}

      {!m ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <>
          <MappingTable
            title="Dealers → QuickBooks customers"
            kind="dealer"
            rows={m.dealers}
            remote={customersQ.data?.data ?? []}
            remoteLoading={customersQ.isLoading}
            busy={busy}
            onSet={(row, qboId) => post({ action: "set", kind: "dealer", local_id: row.id, qbo_id: qboId || null }, `set-d-${row.id}`)}
            onCreate={(row) => post({ action: "create", kind: "dealer", local_id: row.id }, `new-d-${row.id}`, `${row.name} created in QuickBooks`)}
          />

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700" htmlFor="qbo-income-account">
              Income account for products created from here
              <select
                id="qbo-income-account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="">Choose…</option>
                {(accountsQ.data?.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <MappingTable
            title="Invoice products → QuickBooks products"
            kind="product"
            rows={m.products}
            remote={itemsQ.data?.data ?? []}
            remoteLoading={itemsQ.isLoading}
            busy={busy}
            onSet={(row, qboId) => post({ action: "set", kind: "product", local_id: row.id, qbo_id: qboId || null }, `set-p-${row.id}`)}
            onCreate={(row) => {
              if (!account) {
                toast.error("Choose the income account first.");
                return;
              }
              post({ action: "create", kind: "product", local_id: row.id, income_account_id: account }, `new-p-${row.id}`, `${row.label} created in QuickBooks`);
            }}
          />
        </>
      )}
    </div>
  );
}

/** What exists in QuickBooks (customers, products or income accounts), to choose from. */
function useQboRemote(kind: "customers" | "items" | "accounts", enabled: boolean) {
  return useQuery<{ data: Remote[] }>({
    queryKey: ["qbo-remote", kind],
    queryFn: () => fetchJson(`/api/quickbooks/remote?kind=${kind}`),
    enabled,
    staleTime: 5 * 60_000,
  });
}

function MappingTable({
  title,
  kind,
  rows,
  remote,
  remoteLoading,
  busy,
  onSet,
  onCreate,
}: {
  title: string;
  kind: Kind;
  rows: MappingRow[];
  remote: Remote[];
  remoteLoading: boolean;
  busy: string | null;
  onSet: (row: MappingRow, qboId: string) => void;
  onCreate: (row: MappingRow) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">{title}</h2>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => {
          const key = `${kind === "dealer" ? "d" : "p"}-${r.id}`;
          const selectId = `qbo-${key}`;
          return (
            <li key={r.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !r.qbo_id && "bg-amber-50/40")}>
              <div className="min-w-0 flex-1">
                <label htmlFor={selectId} className="font-medium text-slate-800">
                  {kind === "dealer" ? r.name : r.label}
                </label>
                {kind === "product" && (
                  <div className="text-xs text-slate-500">
                    {r.code} · {r.taxable ? "sales tax" : "no sales tax"}
                  </div>
                )}
              </div>
              <select
                id={selectId}
                value={r.qbo_id || ""}
                disabled={busy !== null || remoteLoading}
                onChange={(e) => onSet(r, e.target.value)}
                className={cn(
                  "h-10 min-w-[220px] max-w-full rounded-lg border bg-white px-2 text-sm",
                  r.qbo_id ? "border-slate-200 text-slate-800" : "border-amber-300 text-amber-800",
                )}
              >
                <option value="">{remoteLoading ? "Loading…" : "Not matched"}</option>
                {r.qbo_id && !remote.some((x) => x.id === r.qbo_id) && (
                  <option value={r.qbo_id}>{r.qbo_name || `#${r.qbo_id}`}</option>
                )}
                {remote.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              {!r.qbo_id && (
                <Button variant="outline" size="sm" onClick={() => onCreate(r)} disabled={busy !== null}>
                  <Plus size={13} /> {busy === `new-${key}` ? "Creating…" : "Create in QuickBooks"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
