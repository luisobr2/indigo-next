"use client";

import Link from "next/link";
import { Download, Plus, Receipt } from "lucide-react";
import { cn, fmtDate } from "@/lib/utils";
import type { InvoiceRow, OrderBilling } from "@/lib/billing/invoice";
import { InvoiceStatusBadge, money } from "@/components/billing/invoice-bits";

/**
 * The order's invoice, on the order page: which one it is on, what is still
 * owed, and a way to make it when the order is ready to invoice. Voided
 * invoices stay listed (muted) so the number history is visible.
 */
export function OrderInvoiceCard({
  orderId,
  stageCode,
  billing,
  loading,
  failed,
}: {
  orderId: number;
  stageCode: string;
  billing: OrderBilling | undefined;
  loading: boolean;
  failed: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
        <Receipt size={14} className="text-indigo-700" />
        Invoice
      </div>
      <Body orderId={orderId} stageCode={stageCode} billing={billing} loading={loading} failed={failed} />
    </div>
  );
}

function Body({
  orderId,
  stageCode,
  billing,
  loading,
  failed,
}: {
  orderId: number;
  stageCode: string;
  billing: OrderBilling | undefined;
  loading: boolean;
  failed: boolean;
}) {
  if (loading) return <div className="h-10 animate-pulse rounded-lg bg-slate-100" />;
  if (failed || !billing) {
    return <p className="text-sm text-slate-400">Couldn&apos;t load the invoice for this order.</p>;
  }
  if (!billing.ready) {
    return (
      <p className="text-sm text-slate-500">
        Invoices are still made in QuickBooks. A manager can set up invoicing from the app in Settings.
      </p>
    );
  }

  const rows = billing.invoices;
  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((inv) => (
            <InvoiceItem key={inv.id} inv={inv} />
          ))}
        </ul>
      )}

      {billing.can_create && billing.marked_by_hand ? (
        <div className="space-y-2">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This order was marked Invoiced / Paid by hand
            {billing.marked_at ? ` on ${fmtDate(billing.marked_at)}` : ""}, but it has no invoice here. If it was already
            invoiced in QuickBooks, don&apos;t invoice it again.
            {billing.paid_by_hand
              ? " It was also marked as paid: once you issue the invoice, record the payment that was collected."
              : ""}
          </p>
          <Link
            href={`/billing/invoices/new?orders=${orderId}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
          >
            <Plus size={14} /> Create invoice
          </Link>
        </div>
      ) : billing.can_create ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">
            {rows.length ? "Its invoice was voided, so it can be invoiced again." : "Installed and not invoiced yet."}
          </p>
          <Link
            href={`/billing/invoices/new?orders=${orderId}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
          >
            <Plus size={14} /> Create invoice
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          {stageCode === "invoiced" || stageCode === "closed"
            ? "Invoiced in QuickBooks, before invoicing moved to the app."
            : "It can be invoiced once the door is installed."}
        </p>
      ) : null}
    </div>
  );
}

function InvoiceItem({ inv }: { inv: InvoiceRow }) {
  const voided = inv.state === "cancel";
  const draft = inv.state === "draft";
  const others = inv.order_names.length - 1;
  return (
    <li className={cn("rounded-xl border border-slate-100 p-3", voided && "bg-slate-50")}>
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/billing/invoices/${inv.id}`}
          className={cn(
            "font-semibold hover:text-indigo-700 hover:underline",
            voided ? "text-slate-400" : "text-slate-900",
          )}
        >
          {inv.name ? `#${inv.name}` : "Draft invoice"}
        </Link>
        <InvoiceStatusBadge status={inv.status} />
      </div>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Total</dt>
          <dd className={cn("tabular-nums font-medium", voided ? "text-slate-400 line-through" : "text-slate-800")}>
            {money(inv.total)}
          </dd>
        </div>
        {inv.state === "posted" && (
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Balance due</dt>
            <dd
              className={cn(
                "tabular-nums font-semibold",
                inv.residual > 0.005 ? "text-orange-700" : "text-emerald-700",
              )}
            >
              {money(inv.residual)}
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-1.5 text-xs text-slate-400">
        {draft ? "Not issued yet" : inv.invoice_date ? fmtDate(inv.invoice_date) : ""}
        {others > 0 ? ` · also ${others} other order${others === 1 ? "" : "s"}` : ""}
        {inv.sent_at ? " · sent" : ""}
      </p>
      {inv.state === "posted" && (
        <a
          href={`/api/invoicing/invoices/${inv.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
        >
          <Download size={12} /> PDF
        </a>
      )}
    </li>
  );
}
