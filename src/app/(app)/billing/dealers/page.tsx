"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Mail, Search } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/skeleton";
import { EmptyState, ErrorState } from "@/components/state-cards";

interface DealerBilling {
  id: number;
  name: string;
  invoice_emails: string[];
  uses_main_email: boolean;
  tax_exempt: boolean;
}

/**
 * Where each dealer's invoices go, in one place. The addresses live on the
 * dealer's billing page ("Send invoices to"); this list is how you find it
 * without first having an invoice of that dealer to click through.
 */
export default function BillingDealersPage() {
  const q = useQuery<{ data: DealerBilling[] }>({
    queryKey: ["billing-dealers"],
    queryFn: () => fetchJson("/api/invoicing/dealers"),
  });
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const all = q.data?.data ?? [];
    const t = search.trim().toLowerCase();
    if (!t) return all;
    return all.filter((d) => d.name.toLowerCase().includes(t) || d.invoice_emails.some((e) => e.toLowerCase().includes(t)));
  }, [q.data, search]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Dealer billing</h1>
          <p className="mt-1 text-sm text-slate-500">
            Where each dealer&apos;s invoices are emailed. Open a dealer to change it.
          </p>
        </div>
        <Link href="/billing" className="text-sm font-medium text-indigo-700 hover:underline">
          ← Billing
        </Link>
      </header>

      <div className="relative max-w-sm">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          id="dealer-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a dealer or an email"
          className="h-10 pl-8"
        />
      </div>

      {q.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {q.error && (
        <ErrorState
          title="Couldn't load the dealers"
          message={q.error instanceof Error ? q.error.message : undefined}
          onRetry={() => q.refetch()}
        />
      )}
      {!q.isLoading && !q.error && !rows.length && (
        <EmptyState title="No dealers" message={search ? "Nothing matches that search." : "There are no active dealers."} />
      )}

      {!!rows.length && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
          {rows.map((d) => (
            <li key={d.id}>
              <Link
                href={`/billing/dealers/${d.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">{d.name}</span>
                    {d.tax_exempt && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        Tax exempt
                      </span>
                    )}
                  </div>
                  {d.invoice_emails.length ? (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-600">
                      <Mail size={13} className="shrink-0 text-slate-400" />
                      <span className="min-w-0 break-words">{d.invoice_emails.join(", ")}</span>
                      {d.uses_main_email && <span className="text-xs text-slate-400">(main email)</span>}
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-amber-700">No email: its invoices can&apos;t be emailed yet.</p>
                  )}
                </div>
                <ChevronRight size={16} className="shrink-0 text-slate-300" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
