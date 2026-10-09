"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Receipt } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState } from "@/components/state-cards";
import { Skeleton } from "@/components/skeleton";
import { money } from "./invoice-bits";
import type { DealerBalance } from "@/app/api/invoicing/dealer-balances/route";

interface Group {
  dealer: [number, string] | false;
  total: number;
  orders: Array<{
    id: number;
    name: string;
    client_name: string;
    dealer_ref: string | false;
    customer_po: string | false;
    door_count: number;
    total: number;
    installed_on: string | false;
    zip_missing: boolean;
  }>;
}

/**
 * Installed orders waiting for an invoice, by dealer. Tick one or several of
 * the same dealer and "Create invoice" opens the draft with them. One invoice
 * can carry several orders, like QuickBooks invoice 1219 (two doors and a
 * display).
 */
export function ToInvoicePanel() {
  const router = useRouter();
  const q = useQuery<{ data: Group[] }>({
    queryKey: ["billing-to-invoice"],
    queryFn: () => fetchJson("/api/invoicing/to-invoice"),
  });
  const [picked, setPicked] = useState<{ dealer: number; ids: Set<number> } | null>(null);
  // Folded by dealer: only the name and its figures until someone opens it.
  const [open, setOpen] = useState<Set<number>>(new Set());
  const balancesQ = useQuery<{ data: DealerBalance[] }>({
    queryKey: ["billing-dealer-balances"],
    queryFn: () => fetchJson("/api/invoicing/dealer-balances"),
  });
  const balances = new Map((balancesQ.data?.data ?? []).map((b) => [b.dealerId, b]));

  function toggle(dealerId: number, orderId: number) {
    setPicked((prev) => {
      const same = prev && prev.dealer === dealerId ? new Set(prev.ids) : new Set<number>();
      if (same.has(orderId)) same.delete(orderId);
      else same.add(orderId);
      return same.size ? { dealer: dealerId, ids: same } : null;
    });
  }
  function toggleAll(g: Group) {
    const dealerId = g.dealer ? g.dealer[0] : 0;
    const all = g.orders.map((o) => o.id);
    setPicked((prev) =>
      prev && prev.dealer === dealerId && prev.ids.size === all.length ? null : { dealer: dealerId, ids: new Set(all) },
    );
  }
  function create(ids: number[]) {
    router.push(`/billing/invoices/new?orders=${ids.join(",")}`);
  }

  const groups = q.data?.data ?? [];
  const count = groups.reduce((t, g) => t + g.orders.length, 0);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800">
          <Receipt size={16} className="text-amber-600" />
          To invoice ({count})
        </h2>
        <div className="flex items-center gap-2">
          {picked && (
            <Button size="sm" onClick={() => create([...picked.ids])} className="bg-emerald-600 text-white hover:bg-emerald-700">
              <FileText size={13} /> Create invoice ({picked.ids.size})
            </Button>
          )}
          <Link href="/billing/invoices" className="text-xs font-medium text-indigo-700 hover:underline">
            All invoices →
          </Link>
        </div>
      </div>
      {q.isLoading && <Skeleton className="h-40 rounded-xl" />}
      {q.error && <ErrorState title="Couldn't load orders to invoice" onRetry={() => q.refetch()} />}
      {!q.isLoading && !q.error && !groups.length && (
        <EmptyState title="All caught up" message="No installed orders waiting for an invoice." />
      )}
      <div className="space-y-4">
        {groups.map((g) => {
          const dealerId = g.dealer ? g.dealer[0] : 0;
          const allPicked = picked?.dealer === dealerId && picked.ids.size === g.orders.length;
          const isOpen = open.has(dealerId);
          const bal = balances.get(dealerId);
          return (
            <section key={dealerId} className="rounded-xl border border-slate-100">
              <header className={`flex flex-wrap items-center gap-3 bg-slate-50/60 px-3 py-2 ${isOpen ? "border-b border-slate-100" : ""}`}>
                <button
                  type="button"
                  onClick={() =>
                    setOpen((s0) => {
                      const n = new Set(s0);
                      if (n.has(dealerId)) n.delete(dealerId);
                      else n.add(dealerId);
                      return n;
                    })
                  }
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Hide" : "Show"} the orders of ${g.dealer ? g.dealer[1] : "no dealer"}`}
                  className="-m-1 flex min-h-9 min-w-9 items-center justify-center rounded p-1 text-slate-500 hover:bg-slate-100"
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/billing/dealers/${dealerId}`}
                    className="font-semibold text-indigo-800 underline decoration-indigo-200 underline-offset-2 hover:decoration-indigo-700"
                    title="Billing details: where its invoices are emailed, tax, statement"
                  >
                    {g.dealer ? g.dealer[1] : "No dealer"}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {g.orders.length} to invoice · <span className="tabular-nums">{money(g.total)}</span>
                    {bal && bal.open > 0.005 && (
                      <span className="font-semibold text-rose-700">
                        {" "}
                        · Unpaid <span className="tabular-nums">{money(bal.open)}</span>
                        {bal.overdue > 0.005 && (
                          <>
                            {" "}
                            (<span className="tabular-nums">{money(bal.overdue)}</span> overdue)
                          </>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => create(g.orders.map((o) => o.id))}>
                  Invoice all ({g.orders.length})
                </Button>
              </header>
              {isOpen && (
              <>
              <div className="flex items-center gap-2 border-b border-slate-50 px-3 py-1.5 text-xs text-slate-500">
                <Checkbox checked={allPicked} onCheckedChange={() => toggleAll(g)} aria-label="Select all of this dealer" />
                Select all
              </div>
              <ul>
                {g.orders.map((o) => {
                  const on = picked?.dealer === dealerId && picked.ids.has(o.id);
                  return (
                    <li key={o.id} className="flex items-center gap-3 border-t border-slate-50 px-3 py-2 first:border-t-0">
                      <label className="-m-1 flex min-h-10 min-w-10 cursor-pointer items-center justify-center p-1">
                        <Checkbox checked={on} onCheckedChange={() => toggle(dealerId, o.id)} aria-label={`Select ${o.name}`} />
                      </label>
                      <div className="min-w-0 flex-1">
                        <Link href={`/orders/${o.id}`} className="font-medium text-slate-800 hover:text-indigo-700 hover:underline">
                          {o.client_name}
                        </Link>
                        <div className="truncate text-xs text-slate-400">
                          {o.name}
                          {o.customer_po ? ` · PO ${o.customer_po}` : ""}
                          {o.dealer_ref ? ` · ${o.dealer_ref}` : ""} · {o.door_count} {o.door_count === 1 ? "door" : "doors"}
                          {o.installed_on ? ` · installed ${fmtDate(o.installed_on)}` : ""}
                        </div>
                        {o.zip_missing && (
                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700">
                            <AlertTriangle size={11} /> No ZIP: check the installation fee
                          </div>
                        )}
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-slate-800">{money(o.total)}</span>
                    </li>
                  );
                })}
              </ul>
              </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
