"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ImageIcon, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { fmtDate, cn } from "@/lib/utils";
import { shopDateString } from "@/lib/shop-time";
import {
  PRODUCT_OPTIONS,
  draftTotals,
  freeLine,
  type DraftLine,
  type InvoiceDetail,
  type InvoicePreview,
} from "@/lib/billing/invoice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/skeleton";
import { ErrorState } from "@/components/state-cards";
import { invalidateOrderViews, money } from "@/components/billing/invoice-bits";

/**
 * The draft invoice editor.
 *
 *   /billing/invoices/new?orders=1,2   start from installed orders
 *   /billing/invoices/new?edit=30      change an existing draft
 *
 * What comes in is a proposal from Odoo (one line per door with its product,
 * price and description, one installation-fee line per order, the photos).
 * Everything stays editable, because the examples show Majela adjusting
 * things by hand: a free "production · Display" line, a description with the
 * customer's PO. Saving only creates a DRAFT; the number is given when it is
 * issued on the next screen.
 */
function Editor() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const editId = Number(sp.get("edit")) || null;
  const orderParam = sp.get("orders") || "";

  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [photos, setPhotos] = useState<Set<number>>(new Set());
  const [invoiceDate, setInvoiceDate] = useState(shopDateString(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        let orderIds = orderParam.split(",").map(Number).filter((n) => n > 0);
        let detail: InvoiceDetail | null = null;
        if (editId) {
          detail = (await fetchJson<{ data: InvoiceDetail }>(`/api/invoicing/invoices/${editId}`)).data;
          if (detail.state !== "draft") throw new Error("Only drafts can be edited.");
          orderIds = detail.orders.map((o) => o.id);
        }
        let p: InvoicePreview | null = null;
        if (orderIds.length) {
          p = (
            await fetchJson<{ data: InvoicePreview }>("/api/invoicing/preview", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order_ids: orderIds }),
            })
          ).data;
        }
        if (cancelled) return;
        if (!p && !detail) throw new Error("Pick orders from Billing first.");
        setPreview(p);
        if (detail) {
          setLines(
            detail.lines.map((l) => ({
              order_id: l.order_id,
              kind: l.product_code.startsWith("IND-FEE") ? "fee" : l.order_id ? "door" : "free",
              product_code: l.product_code || "IND-OTHER",
              product_label: l.product_label,
              description: l.description,
              qty: l.qty,
              price_unit: l.price_unit,
              taxable: l.taxable,
            })),
          );
          setPhotos(new Set(detail.photo_ids));
          if (detail.invoice_date) setInvoiceDate(detail.invoice_date);
        } else if (p) {
          setLines(p.lines);
          setPhotos(new Set(p.photos.filter((ph) => ph.default).map((ph) => ph.id)));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't prepare the invoice");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [editId, orderParam]);

  const taxRate = preview?.tax_rate ?? 7;
  const totals = useMemo(() => draftTotals(lines, taxRate), [lines, taxRate]);

  function patch(i: number, p: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...p } : l)));
  }
  function setProduct(i: number, code: string) {
    const opt = PRODUCT_OPTIONS.find((o) => o.code === code);
    if (!opt) return;
    const exempt = preview?.dealer.tax_exempt ?? false;
    patch(i, { product_code: code, product_label: opt.label, taxable: opt.taxable && !exempt });
  }

  async function save() {
    if (!preview && !editId) return;
    if (!lines.length) {
      toast.error("The invoice needs at least one line.");
      return;
    }
    if (lines.some((l) => !(Number(l.qty) > 0))) {
      toast.error("Every line needs a quantity above zero.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        lines: lines.map((l) => ({ ...l, qty: Number(l.qty), price_unit: Number(l.price_unit) })),
        photo_ids: [...photos],
        invoice_date: invoiceDate,
      };
      let id = editId;
      if (editId) {
        await fetchJson(`/api/invoicing/invoices/${editId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        const r = await fetchJson<{ data: number }>("/api/invoicing/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, dealer_id: preview!.dealer.id, order_ids: preview!.order_ids }),
        });
        id = r.data;
      }
      qc.invalidateQueries({ queryKey: ["billing-to-invoice"] });
      qc.invalidateQueries({ queryKey: ["billing-invoices"] });
      invalidateOrderViews(qc);
      toast.success("Draft saved");
      router.push(`/billing/invoices/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the draft");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorState title="Couldn't prepare the invoice" message={error} backHref="/billing" />;
  if (!preview && !lines.length) return <Skeleton className="h-96 rounded-2xl" />;

  const dealer = preview?.dealer;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/billing" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-700">
            <ArrowLeft size={12} /> Billing
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {editId ? "Edit draft invoice" : "New invoice"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {dealer ? (
              <>
                For{" "}
                <Link href={`/billing/dealers/${dealer.id}`} className="font-medium text-slate-700 hover:text-indigo-700 hover:underline">
                  {dealer.name}
                </Link>
                {dealer.tax_exempt ? " · tax exempt" : ` · sales tax ${taxRate}% on doors`}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="flex flex-1 items-center gap-2 text-sm text-slate-600 sm:flex-none">
            Invoice date
            <Input id="invoice-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="h-10 flex-1 sm:w-40 sm:flex-none" />
          </label>
          <Button size="lg" onClick={save} disabled={saving}>
            <Save size={14} /> {saving ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </header>

      {!!preview?.warnings.length && (
        <ul className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {preview.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-none text-amber-600" /> {w}
            </li>
          ))}
        </ul>
      )}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        {/* Telefono: una tarjeta por linea. La tabla de abajo necesita 860 px y
            en un iPhone dejaba el precio (Rate) fuera de la pantalla. */}
        <ul className="divide-y divide-slate-100 md:hidden">
          {lines.map((l, i) => (
            <li key={i} className="space-y-3 p-4">
              <div className="flex items-start gap-2">
                <span className="pt-3 text-xs text-slate-400">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <select
                    id={`m-line-product-${i}`}
                    aria-label="Product or service"
                    value={l.product_code}
                    onChange={(e) => setProduct(i, e.target.value)}
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold uppercase text-slate-800"
                  >
                    {PRODUCT_OPTIONS.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {l.order_name && <div className="mt-1 text-[11px] text-slate-400">{l.order_name}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                  className="mt-1 rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Remove line"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <textarea
                id={`m-line-desc-${i}`}
                aria-label="Description"
                value={l.description}
                onChange={(e) => patch(i, { description: e.target.value })}
                rows={2}
                className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-base text-slate-800"
              />
              <div className="grid grid-cols-[5rem_1fr_auto] items-end gap-3">
                <label className="text-xs font-medium text-slate-500" htmlFor={`m-line-qty-${i}`}>
                  Qty
                  <Input
                    id={`m-line-qty-${i}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={l.qty}
                    onChange={(e) => patch(i, { qty: Number(e.target.value) })}
                    className="mt-1 h-11 text-right text-base tabular-nums"
                  />
                </label>
                <label className="text-xs font-medium text-slate-500" htmlFor={`m-line-rate-${i}`}>
                  Rate (price)
                  <Input
                    id={`m-line-rate-${i}`}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={l.price_unit}
                    onChange={(e) => patch(i, { price_unit: Number(e.target.value) })}
                    className="mt-1 h-11 text-right text-base tabular-nums"
                  />
                </label>
                <label className="flex h-11 items-center gap-2 text-sm text-slate-600" htmlFor={`m-line-tax-${i}`}>
                  <Checkbox id={`m-line-tax-${i}`} checked={l.taxable} onCheckedChange={(v) => patch(i, { taxable: !!v })} />
                  Tax
                </label>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Amount</span>
                <span className="font-semibold tabular-nums text-slate-800">{money((Number(l.qty) || 0) * (Number(l.price_unit) || 0))}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2.5">#</th>
                <th className="w-56 px-3 py-2.5">Product or service</th>
                <th className="px-3 py-2.5">Description</th>
                <th className="w-20 px-3 py-2.5 text-right">Qty</th>
                <th className="w-28 px-3 py-2.5 text-right">Rate</th>
                <th className="w-16 px-3 py-2.5 text-center">Tax</th>
                <th className="w-28 px-3 py-2.5 text-right">Amount</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 pt-4 text-slate-400">{i + 1}.</td>
                  <td className="px-3 py-2">
                    <select
                      id={`line-product-${i}`}
                      value={l.product_code}
                      onChange={(e) => setProduct(i, e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold uppercase text-slate-800"
                    >
                      {PRODUCT_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {l.order_name && <div className="mt-1 text-[11px] text-slate-400">{l.order_name}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <textarea
                      id={`line-desc-${i}`}
                      value={l.description}
                      onChange={(e) => patch(i, { description: e.target.value })}
                      rows={l.description.includes("\n") ? 2 : 1}
                      className="w-full resize-y rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      id={`line-qty-${i}`}
                      type="number"
                      min={1}
                      value={l.qty}
                      onChange={(e) => patch(i, { qty: Number(e.target.value) })}
                      className="h-10 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      id={`line-rate-${i}`}
                      type="number"
                      step="0.01"
                      value={l.price_unit}
                      onChange={(e) => patch(i, { price_unit: Number(e.target.value) })}
                      className="h-10 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2 pt-4 text-center">
                    <Checkbox
                      checked={l.taxable}
                      onCheckedChange={(v) => patch(i, { taxable: !!v })}
                      aria-label="Taxable"
                    />
                  </td>
                  <td className="px-3 py-2 pt-4 text-right font-semibold tabular-nums text-slate-800">
                    {money((Number(l.qty) || 0) * (Number(l.price_unit) || 0))}
                  </td>
                  <td className="px-3 py-2 pt-3">
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Remove line"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-slate-100 px-4 py-4">
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, freeLine()])}>
            <Plus size={13} /> Add line
          </Button>
          <dl className="grid w-full grid-cols-2 gap-y-1.5 text-sm sm:w-64">
            <dt className="text-slate-500">Subtotal</dt>
            <dd className="text-right tabular-nums">{money(totals.untaxed)}</dd>
            <dt className="text-slate-500">Sales tax</dt>
            <dd className="text-right tabular-nums">{money(totals.tax)}</dd>
            <dt className="border-t border-slate-200 pt-1.5 font-semibold">Total</dt>
            <dd className="border-t border-slate-200 pt-1.5 text-right text-base font-bold tabular-nums">{money(totals.total)}</dd>
          </dl>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-800">
          <ImageIcon size={15} className="text-indigo-700" /> Installation photos
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Ticked photos go on the invoice PDF as thumbnails, four per row under the totals. The ones uploaded on or after the installation day come ticked.
        </p>
        {!preview?.photos.length ? (
          <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-400">These orders have no photos yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {preview.photos.map((ph) => {
              const on = photos.has(ph.id);
              return (
                <button
                  key={ph.id}
                  type="button"
                  onClick={() =>
                    setPhotos((prev) => {
                      const n = new Set(prev);
                      if (n.has(ph.id)) n.delete(ph.id);
                      else n.add(ph.id);
                      return n;
                    })
                  }
                  className={cn(
                    "group relative overflow-hidden rounded-xl text-left ring-2 transition",
                    on ? "ring-indigo-500" : "ring-transparent opacity-60 hover:opacity-100",
                  )}
                  aria-pressed={on}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/orders/${ph.order_id}/attachments/${ph.id}`}
                    alt={ph.name}
                    className="aspect-square w-full bg-slate-100 object-cover"
                  />
                  <span className="absolute left-2 top-2">
                    <Checkbox checked={on} tabIndex={-1} aria-hidden />
                  </span>
                  <span className="block truncate px-2 py-1 text-[11px] text-slate-500">
                    {ph.order_name} · {ph.created ? fmtDate(ph.created) : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default function NewInvoicePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <Editor />
    </Suspense>
  );
}
