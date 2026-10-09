"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { cn, fmtMoney, fmtNum } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DigitizationPerson } from "@/app/api/labor/digitization/route";

/**
 * Labor → after-hours digitization. Amado is paid per door when Majela
 * chooses him as an order's designer (Settings → Digitization after hours);
 * this lists what that came to in the chosen dates and lets the office
 * mark it paid.
 */
export function DigitizationSection({ from, to }: { from: string; to: string }) {
  const qc = useQueryClient();
  const q = useQuery<{ people: DigitizationPerson[] }>({
    queryKey: ["labor-digitization", from, to],
    queryFn: () => fetchJson(`/api/labor/digitization?from=${from}&to=${to}`),
  });
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);

  async function markPaid(p: DigitizationPerson) {
    setBusy(p.partnerId);
    try {
      const r = await fetch("/api/billing/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "mark-paid", payoutIds: p.pendingPayoutIds }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `Request failed (${r.status})`);
      toast.success(`${p.name}: ${fmtMoney(p.pending)} marked paid`);
      qc.invalidateQueries({ queryKey: ["labor-digitization"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't mark it paid");
    } finally {
      setBusy(null);
    }
  }

  const people = q.data?.people ?? [];

  return (
    <section className="mt-6 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm" aria-labelledby="labor-digitization">
      <h2 id="labor-digitization" className="flex items-center gap-2 font-semibold text-slate-800">
        <ScanLine size={16} className="text-indigo-700" /> Digitization after hours
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Paid per door when the person is chosen as the order&apos;s designer. The rate is in Settings → Contractor rates.
      </p>
      {q.error && <p className="mt-3 text-sm text-rose-700">Couldn&apos;t load digitization pay.</p>}
      {q.data && !people.length && (
        <p className="mt-3 text-sm text-slate-400">No after-hours digitization in these dates.</p>
      )}
      {!!people.length && (
        <ul className="mt-3 divide-y divide-slate-100">
          {people.map((p) => {
            const isOpen = open.has(p.partnerId);
            return (
              <li key={p.partnerId} className="py-2">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setOpen((s) => {
                        const n = new Set(s);
                        if (n.has(p.partnerId)) n.delete(p.partnerId);
                        else n.add(p.partnerId);
                        return n;
                      })
                    }
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="font-medium text-slate-800">{p.name}</span>
                    <span className="text-xs text-slate-500">
                      {fmtNum(p.orders.length)} order{p.orders.length === 1 ? "" : "s"} · {fmtNum(p.doors)} door{p.doors === 1 ? "" : "s"}
                    </span>
                  </button>
                  <span className="font-semibold tabular-nums text-slate-900">{fmtMoney(p.total)}</span>
                  {p.pending > 0 ? (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => markPaid(p)}>
                      {busy === p.partnerId ? "Marking…" : `Mark ${fmtMoney(p.pending)} paid`}
                    </Button>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-700">Paid</span>
                  )}
                </div>
                {isOpen && (
                  <ul className="mt-2 space-y-1 pl-6 text-sm">
                    {p.orders.map((o, i) => (
                      <li key={`${o.id}-${i}`} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {o.id ? (
                            <Link href={`/orders/${o.id}`} className="text-indigo-700 hover:underline">
                              {o.name}
                            </Link>
                          ) : (
                            o.name
                          )}{" "}
                          <span className="text-xs text-slate-500">
                            {o.date} · {fmtNum(o.doors)} door{o.doors === 1 ? "" : "s"}
                          </span>
                        </span>
                        <span className={cn("tabular-nums", o.paid ? "text-emerald-700" : "text-slate-700")}>
                          {fmtMoney(o.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
