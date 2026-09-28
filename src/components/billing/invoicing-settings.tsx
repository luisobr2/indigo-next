"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Receipt, Save } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBillingStatus } from "./invoice-bits";
import type { BillingStatus } from "@/lib/billing/invoice";

const ISSUER_FIELDS: Array<{ key: string; label: string }> = [
  { key: "issuer_name", label: "Company name" },
  { key: "issuer_street", label: "Street" },
  { key: "issuer_city", label: "City, state, ZIP" },
  { key: "issuer_email", label: "Email" },
  { key: "issuer_phone", label: "Phone" },
  { key: "issuer_website", label: "Website" },
];

/**
 * Settings → Invoicing. Two moments:
 *
 *  1. Before invoicing exists: one button (manager only) that sets up the
 *     accounting in Odoo — chart of accounts, the Florida sales tax, the
 *     invoice products and the numbering. It is a button and not something a
 *     deploy does, because loading a chart of accounts in production is not
 *     something to happen by itself.
 *  2. After: the data that goes on every invoice, the next number (it
 *     continues QuickBooks'), the tax rate and the fee per distance range.
 */
export function InvoicingSettings() {
  const q = useBillingStatus();
  const st = q.data?.data;
  if (q.isLoading || !st) return null;
  // Oficina puede facturar pero no cambiar esto: la seccion no le aparece.
  if (!st.can_setup) return null;
  // key: when the saved values change, the form starts again from them.
  return <InvoicingSettingsForm key={JSON.stringify([st.ready, st.next_number, st.tax_rate, st.issuer, st.ranges])} st={st} />;
}

function InvoicingSettingsForm({ st }: { st: BillingStatus }) {
  const qc = useQueryClient();
  const [issuer, setIssuer] = useState<Record<string, string>>(st.issuer);
  const [nextNumber, setNextNumber] = useState(String(st.next_number));
  const [taxRate, setTaxRate] = useState(String(st.tax_rate));
  const [ranges, setRanges] = useState(st.ranges.map((r) => ({ id: r.id, name: r.name, region: r.region, fee: r.fee })));
  const [busy, setBusy] = useState(false);

  async function setup() {
    setBusy(true);
    try {
      await fetchJson("/api/invoicing/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ next_number: Number(nextNumber) || undefined, tax_rate: Number(taxRate) || undefined }),
      });
      toast.success("Invoicing is set up");
      qc.invalidateQueries({ queryKey: ["billing-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't set up invoicing");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await fetchJson("/api/invoicing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...issuer,
          next_number: Number(nextNumber) || undefined,
          tax_rate: taxRate === "" ? undefined : Number(taxRate),
          ranges,
        }),
      });
      toast.success("Invoicing settings saved");
      qc.invalidateQueries({ queryKey: ["billing-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="invoicing" className="scroll-mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Receipt size={18} className="text-indigo-700" /> Invoicing
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {st.ready
              ? "What goes on every invoice made in the app. The number continues QuickBooks' numbering: while QuickBooks still issues invoices, move it past QuickBooks' last one so they never repeat."
              : "Invoices are still made in QuickBooks. Setting this up creates the accounting in the system (chart of accounts, Florida sales tax, invoice products and numbering). Nothing is invoiced until someone issues an invoice."}
          </p>
        </div>
        {st.ready ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={13} /> Ready
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="text-sm text-slate-700" htmlFor="inv-next">
          Next invoice number
          <Input id="inv-next" type="number" value={nextNumber} onChange={(e) => setNextNumber(e.target.value)} className="mt-1 h-10" />
        </label>
        <label className="text-sm text-slate-700" htmlFor="inv-tax">
          Sales tax on doors (%)
          <Input id="inv-tax" type="number" step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="mt-1 h-10" />
        </label>
        <div className="text-sm text-slate-500 md:pt-6">Installation fees carry no sales tax.</div>
      </div>

      {st.ready && (
        <>
          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-800">On the invoice</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {ISSUER_FIELDS.map((f) => (
              <label key={f.key} className="text-sm text-slate-700" htmlFor={`inv-${f.key}`}>
                {f.label}
                <Input
                  id={`inv-${f.key}`}
                  value={issuer[f.key] ?? ""}
                  onChange={(e) => setIssuer({ ...issuer, [f.key]: e.target.value })}
                  className="mt-1 h-10"
                />
              </label>
            ))}
          </div>
        </>
      )}

      <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-800">Installation fee by distance</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-3">Distance from the shop</th>
              <th className="w-24 py-2 pr-3">Region</th>
              <th className="w-32 py-2">Fee</th>
            </tr>
          </thead>
          <tbody>
            {ranges.map((r, i) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-2 pr-3 text-slate-700">{r.name.replace("millas", "miles")}</td>
                <td className="py-2 pr-3">
                  <Input
                    id={`range-region-${r.id}`}
                    value={r.region}
                    maxLength={2}
                    onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, region: e.target.value.toUpperCase() } : x)))}
                    className="h-9 w-16 text-center uppercase"
                  />
                </td>
                <td className="py-2">
                  <Input
                    id={`range-fee-${r.id}`}
                    type="number"
                    step="0.01"
                    value={r.fee}
                    onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, fee: Number(e.target.value) } : x)))}
                    className="h-9 w-28 text-right"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        A range without a region has no fee product: orders in it are invoiced as region A and flagged for review.
      </p>

      <div className="mt-5 flex justify-end">
        {st.ready ? (
          <Button onClick={save} disabled={busy}>
            <Save size={14} /> {busy ? "Saving…" : "Save invoicing settings"}
          </Button>
        ) : (
          <Button onClick={setup} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
            <CheckCircle2 size={14} /> {busy ? "Setting up…" : "Set up invoicing"}
          </Button>
        )}
      </div>
    </section>
  );
}
