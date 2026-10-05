"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Save, Wallet } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { fmtDate } from "@/lib/utils";
import { parseEmails, type InvoiceStatus } from "@/lib/billing/invoice";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/skeleton";
import { EmptyState, ErrorState } from "@/components/state-cards";
import { InvoiceStatusBadge, money, useBillingStatus } from "@/components/billing/invoice-bits";

interface Statement {
  dealer: {
    id: number;
    name: string;
    emails: string[];
    phone: string | false;
    address: string;
    tax_exempt: boolean;
    template: string;
  };
  open_balance: number;
  overdue: number;
  events: Array<{
    kind: "invoice" | "payment";
    id: number;
    date: string;
    label: string;
    amount: number;
    status: InvoiceStatus | "";
  }>;
}

/**
 * The dealer's account, like the customer page in QuickBooks: open balance,
 * what is overdue, and every invoice and payment. Below, how this dealer's
 * invoices are made: who receives them, sales tax, and what goes in each
 * door's description.
 */
export default function DealerStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const q = useQuery<{ data: Statement }>({
    queryKey: ["billing-dealer", id],
    queryFn: () => fetchJson(`/api/invoicing/dealers/${id}`),
  });
  const statusQ = useBillingStatus();
  const d = q.data?.data;

  if (q.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (q.error || !d) {
    return <ErrorState title="Couldn't load the dealer" onRetry={() => q.refetch()} backHref="/billing" />;
  }

  const templates = statusQ.data?.data.templates ?? [
    { value: "client", label: "Client name" },
    { value: "client_address", label: "Client name + address" },
    { value: "po", label: "REF: PO + client + PO number" },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/billing/invoices" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-700">
            <ArrowLeft size={12} /> Invoices
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{d.dealer.name}</h1>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-500">
            {[d.dealer.address, d.dealer.phone].filter(Boolean).join(" · ") || "No address on file"}
          </p>
        </div>
        <Link href={`/catalog/dealers/${d.dealer.id}`} className="text-sm font-medium text-indigo-700 hover:underline">
          Dealer details →
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <div className="text-xs font-medium text-slate-500">Open balance</div>
          <div className="text-2xl font-bold tabular-nums text-slate-900">{money(d.open_balance)}</div>
        </div>
        <div className="rounded-2xl bg-white p-4 text-right shadow-sm ring-1 ring-slate-100">
          <div className="text-xs font-medium text-slate-500">Overdue payment</div>
          <div className={`text-2xl font-bold tabular-nums ${d.overdue > 0 ? "text-orange-600" : "text-slate-900"}`}>
            {money(d.overdue)}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 lg:col-span-8">
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-800">Transactions</h2>
          {!d.events.length ? (
            <div className="p-4">
              <EmptyState title="No invoices yet" message="Invoices made in the app for this dealer show up here." />
            </div>
          ) : (
            <ul>
              {d.events.map((e) => (
                <li key={`${e.kind}-${e.id}`} className="flex items-center gap-3 border-t border-slate-50 px-4 py-3 first:border-t-0">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    {e.kind === "invoice" ? <FileText size={15} /> : <Wallet size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-400">{fmtDate(e.date)}</div>
                    {e.kind === "invoice" ? (
                      <Link href={`/billing/invoices/${e.id}`} className="font-medium text-slate-800 hover:text-indigo-700 hover:underline">
                        {e.label}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-800">{e.label}</span>
                    )}
                  </div>
                  <div className="text-right">
                    {e.status ? <InvoiceStatusBadge status={e.status as InvoiceStatus} /> : null}
                    <div className="tabular-nums text-slate-800">{money(e.amount)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DealerInvoiceSettings
          key={JSON.stringify(d.dealer)}
          dealerId={id}
          initial={d.dealer}
          templates={templates}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["billing-dealer", id] });
            qc.invalidateQueries({ queryKey: ["billing-dealers"] });
          }}
        />
      </div>
    </div>
  );
}

function DealerInvoiceSettings({
  dealerId,
  initial,
  templates,
  onSaved,
}: {
  dealerId: string;
  initial: Statement["dealer"];
  templates: Array<{ value: string; label: string }>;
  onSaved: () => void;
}) {
  const [emails, setEmails] = useState(initial.emails.join(", "));
  const [exempt, setExempt] = useState(initial.tax_exempt);
  const [template, setTemplate] = useState(initial.template);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await fetchJson(`/api/invoicing/dealers/${dealerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: parseEmails(emails).join(", "), tax_exempt: exempt, template }),
      });
      toast.success("Invoice settings saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 lg:col-span-4">
          <h2 className="font-semibold text-slate-800">How this dealer is invoiced</h2>
          <label className="block text-sm font-medium text-slate-700" htmlFor="dealer-emails">
            Send invoices to
          </label>
          <Textarea
            id="dealer-emails"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            rows={2}
            placeholder="billing@dealer.com, owner@dealer.com"
          />
          <p className="text-xs text-slate-500">Several addresses, separated by commas. Empty uses the dealer&apos;s main email.</p>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <Checkbox checked={exempt} onCheckedChange={(v) => setExempt(!!v)} />
            Sales tax exempt (resale certificate)
          </label>
          <label className="block text-sm font-medium text-slate-700" htmlFor="dealer-template">
            Door description on the invoice
          </label>
          <select
            id="dealer-template"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
          >
            {templates.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500">
            {template === "po"
              ? "Example: REF: PO FRANKLIN 102868"
              : template === "client_address"
                ? "Example: client name, and the install address underneath"
                : "Example: Maria Williams - 4989 (client, and the dealer's reference if there is one)"}
          </p>
          <Button onClick={save} disabled={saving} className="w-full">
            <Save size={14} /> {saving ? "Saving…" : "Save"}
          </Button>
        </section>
  );
}
