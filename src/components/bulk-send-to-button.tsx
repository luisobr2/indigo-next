"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { STAGE_BADGE as STAGE_BADGE_COLOR } from "@/lib/labels";
import {
  Send,
  X,
  ArrowRight,
  Check,
  AlertTriangle,
  ChevronDown,
  Wand2,
} from "lucide-react";
import { STAGE_WIZARDS } from "./stage-wizard-modal";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Stage {
  id: number;
  name: string;
  code: string;
  sequence: number;
}

interface Props {
  /** Array of indigo.order ids the user has ticked. */
  orderIds: number[];
  stages: Stage[];
  /** Called after every order has been processed (success or partial). */
  onSuccess?: () => void;
}

interface SelectedOrder {
  id: number;
  name: string;
  dealer_ref: string;
  stage_id: [number, string] | false;
  stage_code: string;
  is_stock?: boolean;
  cancelled_at?: string | false;
}

const STAGE_GROUPS: Array<{ label: string; codes: string[] }> = [
  {
    label: "Approval & prep",
    codes: ["design_pending", "design_confirmed", "measure_pending", "measured"],
  },
  {
    label: "Production",
    codes: ["ready_digitalization", "cnc", "painting"],
  },
  {
    label: "Installation",
    codes: ["ready_install", "install_scheduled", "installed"],
  },
  {
    label: "Billing & close",
    codes: ["invoiced", "closed"],
  },
];


/**
 * Bulk "Move Selected To" button. Shown next to the "N selected" chip
 * on every list screen so the user can mass-route approved orders to
 * Measurements / Digitalization / wherever in a single click.
 *
 * Coherence guard:
 *   - We pull the current stage of every ticked order.
 *   - When the user picks a target, we compute the forward / backward /
 *     no-op classification per order and show a banner.
 *   - Backwards moves require an explicit "I know" tick before Confirm
 *     unlocks. Forwards & no-ops Just Work.
 *
 * Implementation note: there's no DB transaction across writes. We fan
 * out N concurrent /api/orders/:id/stage POSTs and report partial
 * failures via toast. The chatter on each order keeps the audit trail.
 */
export function BulkSendToButton({ orderIds, stages, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Stage | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [showOrderList, setShowOrderList] = useState(false);
  const [overrideBackwards, setOverrideBackwards] = useState(false);

  const byCode = new Map(stages.map((s) => [s.code, s]));
  const count = orderIds.length;

  // Pull the current stage of every selected order so we can decide
  // forward vs backward moves. Disabled until the dialog opens (no need
  // to thrash the network in the background).
  const ordersQ = useQuery<{ orders: SelectedOrder[] }>({
    queryKey: ["bulk-send-orders", orderIds.sort().join(",")],
    queryFn: async () => {
      // We fetch via the existing /api/orders endpoint. There's no
      // "ids in" filter on the public surface, so we read each order
      // detail in parallel. This is bounded by `count`.
      const fallback = (id: number): SelectedOrder => ({
        id,
        name: `#${id}`,
        dealer_ref: "",
        stage_id: false,
        stage_code: "",
        is_stock: false,
        cancelled_at: false,
      });
      const reads = await Promise.all(
        orderIds.map((id) =>
          fetch(`/api/orders/${id}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => (j?.order as SelectedOrder | undefined) ?? fallback(id))
            .catch(() => fallback(id)),
        ),
      );
      return { orders: reads };
    },
    enabled: open && orderIds.length > 0,
    staleTime: 30_000,
  });

  const ordersLoaded = ordersQ.data?.orders ?? [];

  // Build a sequence-ordered classification once the user picks a
  // target. "forward" = current seq < target seq, "backward" = current
  // seq > target seq, "same" = no-op (already there).
  function classify(order: SelectedOrder, t: Stage | null) {
    if (!t || !order.stage_code) return "unknown" as const;
    const curStage = stages.find((s) => s.code === order.stage_code);
    if (!curStage) return "unknown" as const;
    if (curStage.id === t.id) return "same" as const;
    if (curStage.sequence < t.sequence) return "forward" as const;
    return "backward" as const;
  }

  const counts = (() => {
    if (!target) {
      return { forward: 0, backward: 0, same: 0, unknown: 0 };
    }
    const out = { forward: 0, backward: 0, same: 0, unknown: 0 };
    for (const o of ordersLoaded) {
      const k = classify(o, target);
      out[k] += 1;
    }
    return out;
  })();

  function reset() {
    setOpen(false);
    setTarget(null);
    setNote("");
    setOverrideBackwards(false);
    setShowOrderList(false);
  }

  async function send() {
    if (!target || !count) return;
    setBusy(true);
    const results = await Promise.allSettled(
      orderIds.map((id) =>
        fetch(`/api/orders/${id}/stage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage_id: target.id,
            note,
            source: `Bulk move (${count})`,
          }),
        }).then(async (r) => {
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
          return j;
        }),
      ),
    );
    setBusy(false);

    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      toast.success(`Moved ${count} orders to ${target.name}`);
      reset();
      onSuccess?.();
      return;
    }
    if (failed === count) {
      toast.error(`All ${count} moves failed. Stage write rejected by Odoo.`, {
        duration: 7000,
      });
      return;
    }
    const ok = count - failed;
    toast.warning(
      `${ok} of ${count} orders moved to ${target.name}. ${failed} failed — check the chatter for those orders.`,
      { duration: 8000 },
    );
    reset();
    onSuccess?.();
  }

  if (!count || !stages.length) return null;

  // Wizards fire when LEAVING a stage (the data they capture belongs to
  // the stage being completed, not the next one). So a critical source
  // wizard means an order can't be bulk-advanced because we'd skip the
  // capture. Lightweight wizards (just an optional note: CNC, Measurement)
  // are safe to bulk past.
  //
  // Previous logic checked the TARGET stage, which incorrectly blocked
  // perfectly legal moves like CNC → Painting (the "Mark CNC done"
  // wizard at CNC only captures a note, no payout / no critical data).
  const sourceStagesNeedingWizard = ordersLoaded
    .map((o) => o.stage_code)
    .filter((code) => {
      const cfg = STAGE_WIZARDS[code];
      if (!cfg) return false;
      // A wizard is "critical" when it captures business data the system
      // depends on downstream — SQF (pricing), photo evidence, signature,
      // or the invoice amount. Note-only wizards (CNC done, Measurement
      // confirmed) are safe to bulk past.
      return !!(
        cfg.withSqfTable ||
        cfg.withPhoto ||
        cfg.withSignature ||
        cfg.withAmount
      );
    });
  const blockedSourceStages = Array.from(new Set(sourceStagesNeedingWizard));
  const hasBlockedSource = blockedSourceStages.length > 0;

  const confirmDisabled =
    !target ||
    busy ||
    ordersQ.isLoading ||
    hasBlockedSource ||
    // Backwards moves require an explicit override to unlock.
    (counts.backward > 0 && !overrideBackwards) ||
    // If EVERY order is already in the target stage we have nothing to do.
    (counts.same === ordersLoaded.length && ordersLoaded.length > 0);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        size="sm"
        className="bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
      >
        <Send size={12} />
        Move Selected To…
        <ArrowRight size={12} />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send size={16} className="text-indigo-700" />
              Move {count} order{count === 1 ? "" : "s"} to…
            </DialogTitle>
            <DialogDescription>
              Every ticked order will be routed to the picked stage. The
              note (if any) is logged on each order&apos;s history.{" "}
              <strong>Cancelled or stock orders</strong> in the selection
              still get moved — un-cancel them or release from stock first
              if that&apos;s not what you want.
            </DialogDescription>
          </DialogHeader>

          {/* Current stages summary — collapsible list */}
          {ordersLoaded.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <button
                type="button"
                onClick={() => setShowOrderList((v) => !v)}
                className="flex w-full items-center justify-between text-xs"
              >
                <span className="font-semibold text-slate-700">
                  Current stages of the {ordersLoaded.length} order
                  {ordersLoaded.length === 1 ? "" : "s"}:
                </span>
                <ChevronDown
                  size={12}
                  className={cn(
                    "text-slate-500 transition",
                    !showOrderList && "-rotate-90",
                  )}
                />
              </button>
              {(() => {
                // Group orders by stage_code for a compact summary.
                const byStage = new Map<string, SelectedOrder[]>();
                for (const o of ordersLoaded) {
                  const k = o.stage_code || "_unknown";
                  if (!byStage.has(k)) byStage.set(k, []);
                  byStage.get(k)!.push(o);
                }
                return (
                  <>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {Array.from(byStage.entries()).map(([code, list]) => {
                        const stage = stages.find((s) => s.code === code);
                        return (
                          <span
                            key={code}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                              STAGE_BADGE_COLOR[code] ??
                                "bg-slate-100 text-slate-600",
                            )}
                          >
                            {stage?.name ?? code ?? "(unknown)"}
                            <span className="rounded bg-white/60 px-1 text-[10px]">
                              {list.length}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                    {showOrderList && (
                      <ul className="mt-2 space-y-1 text-[11px]">
                        {ordersLoaded.map((o) => (
                          <li
                            key={o.id}
                            className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1 ring-1 ring-slate-100"
                          >
                            <span className="font-mono text-slate-700">
                              {o.dealer_ref || o.name}
                            </span>
                            <span className="text-slate-500">
                              {(o.stage_id && Array.isArray(o.stage_id)
                                ? o.stage_id[1]
                                : "(no stage)") || "(no stage)"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {!target ? (
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {STAGE_GROUPS.map((grp) => {
                const options = grp.codes
                  .map((c) => byCode.get(c))
                  .filter((s): s is Stage => !!s);
                if (!options.length) return null;
                return (
                  <section key={grp.label}>
                    <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      {grp.label}
                    </h4>
                    <ul className="space-y-1">
                      {options.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => setTarget(s)}
                            className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40"
                          >
                            <span
                              className={cn(
                                "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                STAGE_BADGE_COLOR[s.code] ??
                                  "bg-slate-100 text-slate-700",
                              )}
                            >
                              {s.name}
                            </span>
                            <ArrowRight
                              size={14}
                              className="ml-auto text-slate-300"
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 px-3 py-2 text-sm">
                <span className="text-slate-500">Sending </span>
                <strong className="text-indigo-800">{count} orders</strong>
                <span className="text-slate-500"> to </span>
                <strong className="text-indigo-800">{target.name}</strong>
              </div>

              {/* Critical source-stage wizards capture SQF / photos /
                  signatures / amounts that the system needs downstream.
                  Bulk move can't surface N wizards, so we block here and
                  point the user back to the relevant stage screen where
                  the per-order capture lives. */}
              {hasBlockedSource && (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <div className="flex items-start gap-2">
                    <Wand2
                      size={14}
                      className="mt-0.5 flex-none text-amber-700"
                    />
                    <div>
                      Bulk move blocked. Some selected orders are currently
                      in{" "}
                      <strong>
                        {blockedSourceStages
                          .map((c) => STAGE_WIZARDS[c]?.title || c)
                          .join(", ")}
                      </strong>
                      , which captures per-order data (SQF / photo / amount).
                      Open each order and use its &quot;Save &amp;
                      advance&quot; button so the wizard records the data
                      and contractor payouts are created correctly.
                    </div>
                  </div>
                </div>
              )}

              {/* Coherence analysis */}
              {ordersQ.isLoading && (
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Checking current stages of the selection…
                </div>
              )}
              {!ordersQ.isLoading && counts.same > 0 && (
                <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
                  <strong>{counts.same}</strong>{" "}
                  {counts.same === 1 ? "order is" : "orders are"} already in{" "}
                  <strong>{target.name}</strong> — these will be no-ops.
                </div>
              )}
              {!ordersQ.isLoading && counts.forward > 0 && (
                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  <strong>{counts.forward}</strong>{" "}
                  {counts.forward === 1 ? "order will move" : "orders will move"}{" "}
                  forward in the flow.
                </div>
              )}
              {!ordersQ.isLoading && counts.backward > 0 && (
                <div className="space-y-2 rounded-xl border-2 border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      size={14}
                      className="mt-0.5 flex-none text-rose-600"
                    />
                    <div>
                      <strong>
                        {counts.backward}{" "}
                        {counts.backward === 1 ? "order" : "orders"} would move
                        BACKWARDS
                      </strong>{" "}
                      (currently at a later stage than{" "}
                      <strong>{target.name}</strong>). The original work stays
                      logged in chatter, but the operators downstream will see
                      the order reappear in their queue. Only do this if you
                      really want to redo the step.
                    </div>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-[11px] font-medium text-rose-900 ring-1 ring-rose-200">
                    <input
                      type="checkbox"
                      checked={overrideBackwards}
                      onChange={(e) => setOverrideBackwards(e.target.checked)}
                      className="accent-rose-600"
                    />
                    Yes, move {counts.backward}{" "}
                    {counts.backward === 1 ? "order" : "orders"} backwards
                  </label>
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="bulk-send-note">Note (optional)</Label>
                <Textarea
                  id="bulk-send-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Reason for the move — logged on every order in the batch."
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {target && (
              <Button
                variant="outline"
                onClick={() => {
                  setTarget(null);
                  setOverrideBackwards(false);
                }}
                disabled={busy}
              >
                <X size={14} /> Pick another stage
              </Button>
            )}
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={send}
              disabled={confirmDisabled}
              className="bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
            >
              <Check size={14} />
              {busy ? `Moving ${count}…` : `Confirm — move ${count}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
