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
type StatusResult = { state: "ok"; data: QboStatus } | { state: "missing" } | { state: "forbidden" };

/**
 * Billing → QuickBooks: which QuickBooks customer is each dealer, and which
 * QuickBooks product is each invoice product. An invoice can't go to
 * QuickBooks until its dealer and its products are matched.
 */
export default function QuickBooksMappingsPage() {
  const qc = useQueryClient();
  const statusQ = useQuery<StatusResult>({
    queryKey: ["qbo-status", "page"],
    queryFn: async () => {
      const res = await fetch("/api/quickbooks/status");
      if (res.status === 404) return { state: "missing" };
      if (res.status === 403) return { state: "forbidden" };
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Couldn't load QuickBooks");
      return { state: "ok", data: body.data as QboStatus };
    },
    retry: false,
  });
  const st = statusQ.data?.state === "ok" ? statusQ.data.data : null;
  const connected = !!st?.connected;
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
  const remoteError = [customersQ, itemsQ, accountsQ].find((q) => q.error)?.error;

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const r = await fetchJson<{ data: unknown }>("/api/quickbooks/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return r.data;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
      // A refused token shows up here first: refresh the connection state.
      qc.invalidateQueries({ queryKey: ["qbo-status"] });
      return null;
    } finally {
      setBusy(null);
    }
  }

  /** set and create answer with the whole list: use it instead of reloading. */
  function keep(res: unknown) {
    if (!res || typeof res !== "object" || !("dealers" in res)) return false;
    const { dealers, products } = res as Mappings;
    qc.setQueryData<{ data: Mappings }>(["qbo-mappings"], { data: { dealers, products } });
    return true;
  }

  async function setMatch(kind: Kind, row: MappingRow, qboId: string) {
    const res = await post({ action: "set", kind, local_id: row.id, qbo_id: qboId || null }, `set-${kind[0]}-${row.id}`);
    if (keep(res)) toast.success(qboId ? "Match saved" : "Match removed");
    return !!res;
  }

  async function create(kind: Kind, row: MappingRow) {
    const name = kind === "dealer" ? row.name : row.label;
    const body: Record<string, unknown> = { action: "create", kind, local_id: row.id };
    if (kind === "product" && account) body.income_account_id = account;
    const res = (await post(body, `new-${kind[0]}-${row.id}`)) as (Mappings & { outcome?: string }) | null;
    if (!keep(res)) return;
    if (res?.outcome === "matched") {
      toast.success(`${name} already existed in QuickBooks: matched to it.`);
    } else {
      toast.success(`${name} created in QuickBooks`);
      qc.invalidateQueries({ queryKey: ["qbo-remote", kind === "dealer" ? "customers" : "items"] });
    }
  }

  async function auto() {
    const res = (await post({ action: "auto" }, "auto")) as {
      matched: { dealers: number; products: number };
      missing: { dealers: string[]; products: string[] };
    } | null;
    if (!res) return;
    qc.invalidateQueries({ queryKey: ["qbo-mappings"] });
    const left = res.missing.dealers.length + res.missing.products.length;
    toast.success(
      `Matched ${res.matched.dealers} dealer${res.matched.dealers === 1 ? "" : "s"} and ${res.matched.products} product${res.matched.products === 1 ? "" : "s"}.` +
        (left ? ` ${left} still need a match.` : " Everything is matched."),
      { duration: 8000 },
    );
  }

  if (statusQ.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (statusQ.error || !statusQ.data) {
    return (
      <ErrorState
        title="Couldn't load QuickBooks"
        message={statusQ.error instanceof Error ? statusQ.error.message : undefined}
        onRetry={() => statusQ.refetch()}
      />
    );
  }
  if (statusQ.data.state === "missing") {
    return <ErrorState title="QuickBooks isn't available" message="It isn't installed on this server yet." backHref="/billing" />;
  }
  if (statusQ.data.state === "forbidden") {
    return <ErrorState title="Not for your role" message="Only the office or a manager can see QuickBooks." backHref="/billing" />;
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

      {(remoteError || st?.needs_reconnect) && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700">
          <CircleAlert size={15} />
          {st?.needs_reconnect
            ? "The QuickBooks connection expired or was revoked."
            : `Couldn't read QuickBooks: ${remoteError instanceof Error ? remoteError.message : "unknown error"}`}{" "}
          <Link href="/settings#quickbooks" className="font-semibold underline">
            Check the connection in Settings
          </Link>
        </p>
      )}

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
            onSet={(row, qboId) => setMatch("dealer", row, qboId)}
            onCreate={(row) => create("dealer", row)}
          />

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700" htmlFor="qbo-income-account">
              Income account for products created from here
              <select
                id="qbo-income-account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="h-10 max-w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
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
            onSet={(row, qboId) => setMatch("product", row, qboId)}
            onCreate={(row) => create("product", row)}
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
  onSet: (row: MappingRow, qboId: string) => Promise<boolean>;
  onCreate: (row: MappingRow) => void;
}) {
  // A choice in the list only takes effect with Save, so a slip of the
  // finger doesn't re-point a dealer's invoices.
  const [draft, setDraft] = useState<Record<number, string>>({});
  const forget = (id: number) =>
    setDraft((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">{title}</h2>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => {
          const key = `${kind === "dealer" ? "d" : "p"}-${r.id}`;
          const selectId = `qbo-${key}`;
          const name = kind === "dealer" ? r.name : r.label;
          const current = r.qbo_id || "";
          const value = draft[r.id] ?? current;
          const changed = value !== current;
          return (
            <li key={r.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !r.qbo_id && "bg-amber-50/40")}>
              <div className="min-w-0 flex-1">
                <label htmlFor={selectId} className="font-medium text-slate-800">
                  {name}
                </label>
                {kind === "product" && (
                  <div className="text-xs text-slate-500">
                    {r.code} · {r.taxable ? "sales tax" : "no sales tax"}
                  </div>
                )}
              </div>
              <select
                id={selectId}
                value={value}
                disabled={busy !== null || remoteLoading}
                onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
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
              {changed && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={async () => {
                      if (await onSet(r, value)) forget(r.id);
                    }}
                  >
                    {busy === `set-${key}` ? "Saving…" : "Save"}
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => forget(r.id)}>
                    Cancel
                  </Button>
                </div>
              )}
              {!r.qbo_id && !changed && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCreate(r)}
                  disabled={busy !== null}
                  aria-label={`Create ${name} in QuickBooks`}
                >
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
