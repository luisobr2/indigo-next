"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Send } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { cn, fmtDate } from "@/lib/utils";
import { backfillPlan, backfillSendable, type BackfillReport } from "@/lib/quickbooks/backfill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { money } from "@/components/billing/invoice-bits";

const TONE = {
  ok: "bg-emerald-50 text-emerald-700",
  info: "bg-sky-50 text-sky-700",
  warn: "bg-amber-50 text-amber-800",
  bad: "bg-rose-50 text-rose-700",
};

/**
 * Billing → QuickBooks → invoices issued before connecting. First a report
 * (read only: what QuickBooks already has with each number), then a manager
 * sends the chosen ones. Nothing changes until "Send".
 */
export function QboBackfill({ canSend }: { canSend: boolean }) {
  const qc = useQueryClient();
  const [asked, setAsked] = useState(false);
  const q = useQuery<{ data: BackfillReport }>({
    queryKey: ["qbo-backfill"],
    queryFn: () => fetchJson("/api/quickbooks/backfill"),
    enabled: asked,
    staleTime: 0,
  });
  const rows = useMemo(() => q.data?.data.rows ?? [], [q.data]);
  // Everything that can go is ticked; the person unticks what they want to keep out.
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const chosen = rows.filter((r) => backfillSendable(r) && !skipped.has(r.id));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  function toggle(id: number) {
    setSkipped((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    setBusy(true);
    try {
      const r = await fetchJson<{ data: { queued: number } }>("/api/quickbooks/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ move_ids: chosen.map((r) => r.id) }),
      });
      toast.success(`${r.data.queued} invoice${r.data.queued === 1 ? "" : "s"} on the way to QuickBooks. Their status shows on each invoice.`, {
        duration: 8000,
      });
      setConfirm(false);
      setSkipped(new Set());
      qc.invalidateQueries({ queryKey: ["qbo-backfill"] });
      qc.invalidateQueries({ queryKey: ["qbo-status"] });
      qc.invalidateQueries({ queryKey: ["billing-invoices"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send them");
    } finally {
      setBusy(false);
    }
  }

  const c = q.data?.data.counts;

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100" aria-labelledby="qbo-backfill-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="qbo-backfill-title" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <History size={15} className="text-indigo-700" /> Invoices issued before connecting
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            They aren&apos;t linked to QuickBooks yet; many were copied there by hand with the same number. Check
            them first: nothing changes until you press Send.
          </p>
        </div>
        <Button variant="outline" onClick={() => (asked ? q.refetch() : setAsked(true))} disabled={q.isFetching}>
          {q.isFetching ? "Checking QuickBooks…" : asked ? "Check again" : "Check invoices"}
        </Button>
      </div>

      {q.error && (
        <p className="mt-3 text-sm text-rose-700">
          {q.error instanceof Error ? q.error.message : "Couldn't check QuickBooks"}
        </p>
      )}

      {q.data && !rows.length && <p className="mt-3 text-sm text-emerald-700">Every issued invoice is already linked.</p>}

      {!!rows.length && c && (
        <>
          <p className="mt-3 text-sm text-slate-600">
            {[
              c.same && `${c.same} already there`,
              c.different && `${c.different} with a different total`,
              c.missing - (c.blocked ?? 0) > 0 && `${c.missing - (c.blocked ?? 0)} to create`,
              c.blocked && `${c.blocked} can't be sent yet`,
              c.other_customer && `${c.other_customer} number taken`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <span className="sr-only">Send</span>
                  </th>
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Dealer</th>
                  <th className="px-3 py-2 text-right">Total here</th>
                  <th className="px-3 py-2 text-right">In QuickBooks</th>
                  <th className="px-3 py-2">What happens</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const plan = backfillPlan(r);
                  const ok = backfillSendable(r);
                  const id = `qbo-bf-${r.id}`;
                  return (
                    <tr key={r.id} className={cn("border-t border-slate-100 align-top", !ok && "opacity-70")}>
                      <td className="px-3 py-2">
                        <input
                          id={id}
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          checked={ok && !skipped.has(r.id)}
                          disabled={!ok || !canSend}
                          onChange={() => toggle(r.id)}
                          aria-label={`Send invoice #${r.name}`}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link href={`/billing/invoices/${r.id}`} className="font-semibold text-indigo-700 hover:underline">
                          #{r.name}
                        </Link>
                        {r.invoice_date && <div className="text-xs text-slate-400">{fmtDate(r.invoice_date)}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.dealer}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                        {typeof r.qbo_total === "number" ? money(r.qbo_total) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold", TONE[plan.tone])}>
                          {plan.label}
                        </span>
                        <div className="mt-0.5 text-xs text-slate-500">{plan.detail}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={() => setConfirm(true)} disabled={!canSend || !chosen.length || busy}>
              <Send size={14} /> {`Send ${chosen.length} to QuickBooks`}
            </Button>
            {!canSend && <span className="text-xs text-slate-500">Only a manager can send them.</span>}
          </div>
        </>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{`Send ${chosen.length} invoice${chosen.length === 1 ? "" : "s"} to QuickBooks?`}</DialogTitle>
            <DialogDescription>
              The ones already there are linked (QuickBooks keeps what it has, and its payments come here). The rest
              are created with the same number. It takes a few minutes; each invoice shows its status.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Not now
            </Button>
            <Button onClick={send} disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
