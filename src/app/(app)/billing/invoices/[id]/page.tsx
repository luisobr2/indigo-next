"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, Download, Mail, Pencil, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { shopDateString } from "@/lib/shop-time";
import { parseEmails, type InvoiceDetail } from "@/lib/billing/invoice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/skeleton";
import { ErrorState } from "@/components/state-cards";
import { InvoiceStatusBadge, money } from "@/components/billing/invoice-bits";

const METHODS = [
  { value: "check", label: "Check" },
  { value: "transfer", label: "Bank transfer" },
  { value: "zelle", label: "Zelle" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery<{ data: InvoiceDetail }>({
    queryKey: ["billing-invoice", id],
    queryFn: () => fetchJson(`/api/invoicing/invoices/${id}`),
  });
  const [pdfKey, setPdfKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [message, setMessage] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: "", date: shopDateString(new Date()), method: "check", reference: "" });

  const inv = q.data?.data;

  function refresh() {
    qc.invalidateQueries({ queryKey: ["billing-invoice", id] });
    qc.invalidateQueries({ queryKey: ["billing-invoices"] });
    qc.invalidateQueries({ queryKey: ["billing-to-invoice"] });
    setPdfKey((k) => k + 1);
  }

  async function act(url: string, body?: unknown, ok?: string) {
    setBusy(true);
    try {
      await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (ok) toast.success(ok);
      refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    if (await act(`/api/invoicing/invoices/${id}/post`, {}, "Invoice issued")) setConfirmIssue(false);
  }
  async function remove() {
    setBusy(true);
    try {
      await fetchJson(`/api/invoicing/invoices/${id}`, { method: "DELETE" });
      toast.success("Draft deleted");
      qc.invalidateQueries({ queryKey: ["billing-to-invoice"] });
      router.push("/billing");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete the draft");
    } finally {
      setBusy(false);
    }
  }
  async function voidInvoice() {
    if (await act(`/api/invoicing/invoices/${id}/void`, { reason: voidReason.trim() || null }, "Invoice voided")) {
      setVoidOpen(false);
      setVoidReason("");
    }
  }
  function openSend() {
    setEmails((inv?.dealer_emails ?? []).join(", "));
    setMessage("");
    setSendOpen(true);
  }
  async function send() {
    const list = parseEmails(emails);
    if (!list.length) {
      toast.error("Add at least one valid email address.");
      return;
    }
    if (await act(`/api/invoicing/invoices/${id}/send`, { emails: list, message: message.trim() || null }, `Sent to ${list.join(", ")}`)) {
      setSendOpen(false);
    }
  }
  function openPay() {
    setPay({ amount: String(inv?.residual ?? ""), date: shopDateString(new Date()), method: "check", reference: "" });
    setPayOpen(true);
  }
  async function registerPayment() {
    if (await act(`/api/invoicing/invoices/${id}/payment`, { ...pay, amount: Number(pay.amount) }, "Payment recorded")) {
      setPayOpen(false);
    }
  }

  if (q.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (q.error || !inv) {
    return (
      <ErrorState
        title="Couldn't load the invoice"
        message={q.error instanceof Error ? q.error.message : undefined}
        onRetry={() => q.refetch()}
        backHref="/billing/invoices"
      />
    );
  }

  const isDraft = inv.state === "draft";
  const title = inv.name ? `Invoice #${inv.name}` : "Draft invoice";
  const pdfUrl = `/api/invoicing/invoices/${inv.id}/pdf?v=${pdfKey}`;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/billing/invoices" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-700">
            <ArrowLeft size={12} /> Invoices
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {title}
            <InvoiceStatusBadge status={inv.status} className="text-xs" />
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {inv.dealer && (
              <Link href={`/billing/dealers/${inv.dealer[0]}`} className="font-medium text-slate-700 hover:text-indigo-700 hover:underline">
                {inv.dealer[1]}
              </Link>
            )}
            {inv.invoice_date ? ` · ${fmtDate(inv.invoice_date)}` : ""}
            {inv.sent_at ? ` · sent ${fmtDateTime(inv.sent_at)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isDraft ? (
            <>
              <Button variant="outline" size="lg" onClick={() => setConfirmDelete(true)} disabled={busy}>
                <Trash2 size={14} /> Delete draft
              </Button>
              <Button variant="outline" size="lg" onClick={() => router.push(`/billing/invoices/new?edit=${inv.id}`)} disabled={busy}>
                <Pencil size={14} /> Edit
              </Button>
              <Button size="lg" onClick={() => setConfirmIssue(true)} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
                <CheckCircle2 size={14} /> Issue invoice
              </Button>
            </>
          ) : (
            <>
              <a
                href={`/api/invoicing/invoices/${inv.id}/pdf?download=1`}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download size={14} /> PDF
              </a>
              {inv.state === "posted" && !inv.payments.length && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setVoidOpen(true)}
                  disabled={busy}
                  className="border-rose-200 text-rose-700 hover:bg-rose-50"
                >
                  <Ban size={14} /> Void
                </Button>
              )}
              {inv.state === "posted" && inv.residual > 0 && (
                <Button variant="outline" size="lg" onClick={openPay} disabled={busy}>
                  <Wallet size={14} /> Record payment
                </Button>
              )}
              {inv.state === "posted" && (
                <Button size="lg" onClick={openSend} disabled={busy}>
                  <Mail size={14} /> {inv.sent_at ? "Send again" : "Send"}
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 lg:col-span-8">
          <iframe key={pdfKey} src={pdfUrl} title={title} className="h-[80vh] min-h-[640px] w-full" />
        </section>

        <aside className="space-y-4 lg:col-span-4">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="text-right tabular-nums">{money(inv.untaxed)}</dd>
              <dt className="text-slate-500">Sales tax</dt>
              <dd className="text-right tabular-nums">{money(inv.tax)}</dd>
              <dt className="border-t border-slate-100 pt-1.5 font-semibold">Total</dt>
              <dd className="border-t border-slate-100 pt-1.5 text-right font-bold tabular-nums">{money(inv.total)}</dd>
              {!isDraft && (
                <>
                  <dt className="text-slate-500">Balance due</dt>
                  <dd className="text-right font-semibold tabular-nums text-orange-700">{money(inv.residual)}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Orders</h2>
            {inv.orders.length ? (
              <ul className="space-y-1 text-sm">
                {inv.orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="text-slate-700 hover:text-indigo-700 hover:underline">
                      {o.client_name}
                    </Link>
                    <span className="ml-1 text-xs text-slate-400">{o.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No orders linked.</p>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Payments</h2>
            {inv.payments.length ? (
              <ul className="space-y-1.5 text-sm">
                {inv.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span className="text-slate-600">
                      {fmtDate(p.date)}
                      {p.memo ? <span className="ml-1 text-xs text-slate-400">{p.memo}</span> : null}
                    </span>
                    <span className="tabular-nums text-emerald-700">{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">{isDraft ? "Issue the invoice to record payments." : "No payments yet."}</p>
            )}
          </section>

          {inv.sent_to && (
            <section className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-100">
              <h2 className="mb-1 font-semibold text-slate-800">Last sent to</h2>
              <p className="break-words text-slate-600">{inv.sent_to}</p>
            </section>
          )}
        </aside>
      </div>

      {/* Emitir: el numero no tiene vuelta atras. */}
      <Dialog open={confirmIssue} onOpenChange={setConfirmIssue}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Issue this invoice?</DialogTitle>
            <DialogDescription>
              It gets the next invoice number and can no longer be edited or deleted, only voided. Its orders move to
              Invoiced. Total {money(inv.total)}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmIssue(false)}>
              Not yet
            </Button>
            <Button onClick={issue} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {busy ? "Issuing…" : "Issue invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>Its orders go back to the list waiting for an invoice.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button onClick={remove} disabled={busy} className="bg-rose-600 text-white hover:bg-rose-700">
              Delete draft
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Anular: conserva el numero y devuelve las ordenes a "por facturar". */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void invoice #{inv.name}?</DialogTitle>
            <DialogDescription>
              It keeps its number but stops counting, and its orders go back to the list waiting for an invoice so you
              can make the right one. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <label className="block text-sm font-medium text-slate-700" htmlFor="void-reason">
            Reason (optional)
          </label>
          <Textarea
            id="void-reason"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            rows={2}
            placeholder="Wrong price, wrong dealer…"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVoidOpen(false)}>
              Keep it
            </Button>
            <Button onClick={voidInvoice} disabled={busy} className="bg-rose-600 text-white hover:bg-rose-700">
              {busy ? "Voiding…" : "Void invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send invoice #{inv.name}</DialogTitle>
            <DialogDescription>The PDF goes attached, with the installation photos. Separate addresses with commas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700" htmlFor="send-emails">
              To
            </label>
            <Textarea id="send-emails" value={emails} onChange={(e) => setEmails(e.target.value)} rows={2} placeholder="billing@dealer.com, owner@dealer.com" />
            <p className="text-xs text-slate-500">{parseEmails(emails).length} valid address(es)</p>
            <label className="block text-sm font-medium text-slate-700" htmlFor="send-message">
              Message (optional)
            </label>
            <Textarea id="send-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Leave empty for the standard message." />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSendOpen(false)}>
              Cancel
            </Button>
            <Button onClick={send} disabled={busy}>
              <Mail size={14} /> {busy ? "Sending…" : "Send"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>Balance due {money(inv.residual)}. A smaller amount records a partial payment.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-1 text-sm text-slate-700" htmlFor="pay-amount">
              Amount
              <Input id="pay-amount" type="number" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className="mt-1 h-10" />
            </label>
            <label className="col-span-1 text-sm text-slate-700" htmlFor="pay-date">
              Date
              <Input id="pay-date" type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} className="mt-1 h-10" />
            </label>
            <label className="col-span-1 text-sm text-slate-700" htmlFor="pay-method">
              Method
              <select
                id="pay-method"
                value={pay.method}
                onChange={(e) => setPay({ ...pay, method: e.target.value })}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-1 text-sm text-slate-700" htmlFor="pay-ref">
              Reference
              <Input id="pay-ref" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="Check #, transfer ID" className="mt-1 h-10" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button onClick={registerPayment} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {busy ? "Saving…" : "Record payment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
