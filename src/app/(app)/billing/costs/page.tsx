"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Paperclip, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { cn, fmtMoney } from "@/lib/utils";
import { shopDateString } from "@/lib/shop-time";
import {
  EXPENSE_CATEGORIES,
  monthOf,
  shiftMonth,
  type Expense,
  type ExpenseCategory,
  type MonthCosts,
} from "@/lib/costing/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/skeleton";
import { ErrorState } from "@/components/state-cards";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CATEGORY_LABEL = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, c.label])) as Record<ExpenseCategory, string>;

function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Billing → Costs. The REAL month, as Majela put it: "en octubre vendí tanto,
 * gasté tanto en material y tanto en gente, se quedó tanto". Next to it, what
 * the estimate per door said for the same invoices, to see if the estimate is
 * well made. Purchase bills are entered here (photo or PDF of the bill).
 */
export default function CostsPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const monthQ = useQuery<{ data: MonthCosts }>({
    queryKey: ["cost-month", month],
    queryFn: () => fetchJson(`/api/costing/month?month=${month}`),
  });
  const expQ = useQuery<{ data: Expense[] }>({
    queryKey: ["expenses", month],
    queryFn: () => fetchJson(`/api/costing/expenses?month=${month}`),
  });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ date: shopDateString(new Date()), supplier: "", category: "acm" as ExpenseCategory, amount: "", note: "" });
  const [file, setFile] = useState<File | null>(null);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["cost-month"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
  }

  async function addExpense() {
    const amount = Number(form.amount);
    if (!form.supplier.trim()) return toast.error("Write who the purchase was from.");
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Write the total of the bill.");
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
    if (file) fd.append("file", file);
    setBusy(true);
    try {
      await fetchJson("/api/costing/expenses", { method: "POST", body: fd });
      toast.success("Purchase saved");
      setAdding(false);
      setForm((f) => ({ ...f, supplier: "", amount: "", note: "" }));
      setFile(null);
      // The bill may belong to another month than the one on screen.
      setMonth(form.date.slice(0, 7));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save it");
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: Expense) {
    if (!window.confirm(`Delete the ${fmtMoney(e.amount)} bill from ${e.supplier}?`)) return;
    try {
      await fetchJson(`/api/costing/expenses/${e.id}`, { method: "DELETE" });
      toast.success("Purchase deleted");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete it");
    }
  }

  const m = monthQ.data?.data;
  const expenses = expQ.data?.data ?? [];

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Costs</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            The real month: what was sold against what was bought and paid. Beside it, what the estimate per door
            said for the same invoices.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/billing" className="text-sm font-medium text-indigo-700 hover:underline">
            ← Billing
          </Link>
          <div className="flex items-center rounded-lg border border-slate-200 bg-white">
            <button type="button" aria-label="Previous month" onClick={() => setMonth((x) => shiftMonth(x, -1))} className="p-2 hover:bg-slate-50">
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-36 text-center text-sm font-semibold text-slate-800">{monthLabel(month)}</span>
            <button type="button" aria-label="Next month" onClick={() => setMonth((x) => shiftMonth(x, 1))} className="p-2 hover:bg-slate-50">
              <ChevronRight size={16} />
            </button>
          </div>
          <Button onClick={() => setAdding(true)}>
            <Plus size={14} /> Add purchase
          </Button>
        </div>
      </header>

      {monthQ.error ? (
        <ErrorState title="Couldn't load the month" onRetry={() => monthQ.refetch()} />
      ) : !m ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Figure label="Sold" value={m.sold} hint={`${m.invoices} invoice${m.invoices === 1 ? "" : "s"} · ${m.doors} doors · before tax`} />
            <Figure label="Spent" value={m.spent} hint="Purchases + pay" />
            <Figure label="Result" value={m.result} tone={m.result < 0 ? "bad" : "good"} hint="Sold − spent" />
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Breakdown
              title="Purchases"
              total={m.purchases_total}
              rows={EXPENSE_CATEGORIES.map((c) => ({ label: c.label, amount: m.purchases[c.value] ?? 0 })).filter((r) => r.amount)}
              empty="No purchase bills this month yet."
            />
            <Breakdown
              title="Pay"
              total={m.people_total}
              rows={[
                { label: "Installers", amount: m.people.installer },
                { label: "Digitization after hours", amount: m.people.digitizer },
                { label: "Painting", amount: m.people.painter },
              ].filter((r) => r.amount)}
              empty="No pay recorded this month."
            />
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Is the estimate right?</h2>
              <dl className="mt-2 grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-slate-500">Estimated cost</dt>
                <dd className="text-right tabular-nums">{fmtMoney(m.estimate)}</dd>
                <dt className="text-slate-500">Real spent</dt>
                <dd className="text-right tabular-nums">{fmtMoney(m.spent)}</dd>
                <dt className="border-t border-slate-100 pt-1.5 font-semibold">Difference</dt>
                <dd className={cn("border-t border-slate-100 pt-1.5 text-right font-bold tabular-nums", m.spent > m.estimate ? "text-rose-700" : "text-emerald-700")}>
                  {fmtMoney(m.spent - m.estimate)}
                </dd>
              </dl>
              <p className="mt-2 text-xs text-slate-400">
                The estimate is for the doors invoiced this month. Material is bought for stock, so a month with a big
                purchase looks worse and the next one better: compare over a few months.
              </p>
            </div>
          </section>
        </>
      )}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Purchase bills · {monthLabel(month)}</h2>
        {expQ.isLoading ? (
          <Skeleton className="m-4 h-24 rounded-xl" />
        ) : !expenses.length ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">None yet. &ldquo;Add purchase&rdquo; to enter a bill with its photo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">From</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Bill</th>
                  <th className="px-3 py-2"><span className="sr-only">Delete</span></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{e.date}</td>
                    <td className="px-3 py-2">
                      <div className="text-slate-800">{e.supplier}</div>
                      {e.note && <div className="text-xs text-slate-400">{e.note}</div>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{CATEGORY_LABEL[e.category] ?? e.category}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtMoney(e.amount)}</td>
                    <td className="px-3 py-2">
                      {e.attachment_id ? (
                        <a href={`/api/costing/expenses/${e.id}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-700 hover:underline">
                          <Paperclip size={13} /> View
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => remove(e)} aria-label={`Delete the bill from ${e.supplier}`} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a purchase bill</DialogTitle>
            <DialogDescription>Material bought for stock counts in the month of the bill.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label htmlFor="exp-supplier" className="block text-sm text-slate-700">
              From
              <Input id="exp-supplier" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="Supplier" className="mt-1" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label htmlFor="exp-date" className="block text-sm text-slate-700">
                Date
                <Input id="exp-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1" />
              </label>
              <label htmlFor="exp-amount" className="block text-sm text-slate-700">
                Total
                <Input id="exp-amount" type="number" min={0} step={0.01} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" className="mt-1 tabular-nums" />
              </label>
            </div>
            <label htmlFor="exp-category" className="block text-sm text-slate-700">
              Type
              <select id="exp-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="exp-note" className="block text-sm text-slate-700">
              Note <span className="text-slate-400">(optional)</span>
              <Input id="exp-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1" />
            </label>
            <label htmlFor="exp-file" className="block text-sm text-slate-700">
              Photo or PDF of the bill <span className="text-slate-400">(optional)</span>
              <input id="exp-file" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
            </label>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button onClick={addExpense} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", tone === "bad" ? "text-rose-700" : tone === "good" ? "text-emerald-700" : "text-slate-900")}>
        {fmtMoney(value)}
      </div>
      <div className="mt-0.5 text-xs text-slate-400">{hint}</div>
    </div>
  );
}

function Breakdown({ title, total, rows, empty }: { title: string; total: number; rows: Array<{ label: string; amount: number }>; empty: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <h2 className="flex justify-between text-sm font-semibold text-slate-800">
        {title} <span className="tabular-nums">{fmtMoney(total)}</span>
      </h2>
      {rows.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.label} className="flex justify-between">
              <span className="text-slate-600">{r.label}</span>
              <span className="tabular-nums text-slate-800">{fmtMoney(r.amount)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-400">{empty}</p>
      )}
    </div>
  );
}
