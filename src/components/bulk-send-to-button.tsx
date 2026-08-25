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
import { writeWithNetworkRecovery } from "@/lib/resilient-write";
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
  // Facturacion en bloque: se pregunta una vez y se aplica a todo el lote.
  const [paymentState, setPaymentState] = useState<"paid" | "partial">("paid");
  const [paymentRef, setPaymentRef] = useState("");

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
    setPaymentState("paid");
    setPaymentRef("");
  }

  async function send() {
    if (!target || !count) return;
    setBusy(true);
    const stage = target;
    // Se resuelve UNA vez, fuera del bucle, para que las N ordenes del lote
    // lleven exactamente lo mismo. `isInvoiceBulk` se declara mas abajo pero
    // ya esta asignado cuando esto se ejecuta: send() solo se llama desde el
    // render, o sea despues de que el cuerpo del componente termine.
    const invoice = isInvoiceBulk
      ? { payment_state: paymentState, payment_ref: paymentRef.trim() }
      : undefined;
    // Same dead-connection recovery as the single-order Send To (see
    // src/lib/resilient-write.ts): a flaky link used to turn straight into
    // "N failed" here, with no retry and no way to tell a network drop
    // apart from Odoo refusing the write.
    const results = await Promise.allSettled(
      orderIds.map((id) =>
        writeWithNetworkRecovery({
          write: async () => {
            const r = await fetch(`/api/orders/${id}/stage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                stage_id: stage.id,
                note,
                source: `Bulk move (${count})`,
                ...(invoice ? { invoice } : {}),
              }),
            });
            const text = await r.text();
            let j: { ok?: boolean; error?: string } = {};
            try {
              j = text ? JSON.parse(text) : {};
            } catch {
              /* not JSON — fall through to the status-code message */
            }
            if (!r.ok || !j.ok) throw new Error(j.error || `Request failed (${r.status})`);
          },
          landed: async () => {
            const r = await fetch(`/api/orders/${id}`, { cache: "no-store" });
            if (!r.ok) return false;
            const j = await r.json();
            return j?.order?.stage_code === stage.code;
          },
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
      // Report the actual reason. Asserting "rejected by Odoo" was a guess,
      // and a wrong one whenever the cause was the connection.
      const first = results.find((r) => r.status === "rejected");
      const reason =
        first && first.status === "rejected" && first.reason instanceof Error
          ? first.reason.message
          : "Unknown error";
      toast.error(`All ${count} moves failed. ${reason}`, { duration: 7000 });
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
  const criticalSourceStages = Array.from(new Set(sourceStagesNeedingWizard));

  /**
   * Excepcion: facturar en bloque desde Installed.
   *
   * La regla de arriba bloqueaba TODO movimiento masivo que saliera de
   * Installed, porque su asistente marca `withAmount`. Se fue a mirar que
   * captura de verdad y para el paso Installed -> Invoiced / Paid no protege
   * nada de lo que el aviso decia: los pagos a instaladores se crean al ENTRAR
   * en Installed (ya estan hechos), no hay SQF ni foto en este paso, y el
   * importe lo rellena el propio asistente desde `total_dealer_charge` -- y no
   * lo guarda en ningun campo, solo lo escribe en el historial.
   *
   * Lo unico real que aporta es el estado de cobro. Asi que en vez de bloquear
   * se pregunta una vez para todo el lote. 41 clics pasan a ser uno sin perder
   * nada.
   *
   * Sigue bloqueado salir de CNC, Painting o Installation Scheduled: ahi si se
   * capturan SQF, fotos y firmas que no se pueden inventar para un lote.
   */
  const isInvoiceBulk =
    target?.code === "invoiced" &&
    criticalSourceStages.length > 0 &&
    criticalSourceStages.every((c) => c === "installed");

  const blockedSourceStages = isInvoiceBulk ? [] : criticalSourceStages;
  const hasBlockedSource = blockedSourceStages.length > 0;

  // Las que de verdad se mueven. `same` ya esta en el destino y `unknown` son
  // las canceladas o en stock: contarlas en el boton era prometer un numero
  // que no iba a pasar.
  const movable = counts.forward + counts.backward;

  const confirmDisabled =
    !target ||
    busy ||
    ordersQ.isLoading ||
    hasBlockedSource ||
    // Backwards moves require an explicit override to unlock.
    (counts.backward > 0 && !overrideBackwards) ||
    // If EVERY order is already in the target stage we have nothing to do.
    (counts.same === ordersLoaded.length && ordersLoaded.length > 0) ||
    // Ni una sola se mueve (p. ej. todo lo tildado esta cancelado): confirmar
    // solo produciria una tanda de fallos.
    (movable === 0 && !ordersQ.isLoading);

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
                        {/* El NOMBRE DE LA ETAPA, no el titulo del asistente.
                            Decia "currently in Invoice and mark paid", que es
                            el nombre de una accion: ninguna orden esta nunca
                            ahi, y quien lo leia no podia saber cuales apartar. */}
                        {blockedSourceStages
                          .map((c) => byCode.get(c)?.name || c)
                          .join(", ")}
                      </strong>
                      , where leaving the stage captures per-order data
                      {" ("}
                      {Array.from(
                        new Set(
                          blockedSourceStages.flatMap((c) => {
                            const cfg = STAGE_WIZARDS[c];
                            return [
                              cfg?.withSqfTable ? "SQF" : "",
                              cfg?.withPhoto ? "photo" : "",
                              cfg?.withSignature ? "signature" : "",
                            ].filter(Boolean);
                          }),
                        ),
                      ).join(" / ")}
                      {")"} that can&apos;t be filled in for a whole batch.
                      Open each order and use its &quot;Save &amp;
                      advance&quot; button.
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
              {/* Las canceladas y las de stock. El dialogo ya lo avisaba en
                  prosa arriba, pero sin numero: con 45 tildadas nadie sabia
                  cuantas de las suyas caian aqui. */}
              {!ordersQ.isLoading && counts.unknown > 0 && (
                <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
                  <strong>{counts.unknown}</strong>{" "}
                  {counts.unknown === 1 ? "order is" : "orders are"} cancelled,
                  in stock, or couldn&apos;t be read — those stay where they
                  are.
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

              {/* Facturar en bloque. Sustituye al bloqueo: lo unico que el
                  asistente por orden aporta de verdad en este paso es el
                  estado de cobro, asi que se pregunta una vez. El importe NO
                  se pide -- cada orden ya tiene el suyo calculado, y el
                  servidor lo lee de ahi. */}
              {isInvoiceBulk && !ordersQ.isLoading && (
                <div className="space-y-2 rounded-xl border-2 border-indigo-200 bg-indigo-50/60 px-3 py-2.5 text-xs text-indigo-900">
                  <div className="font-semibold">
                    Invoicing {movable} {movable === 1 ? "order" : "orders"}
                  </div>
                  <p className="text-[11px] text-indigo-800/80">
                    Each order is logged with its own calculated amount. Only
                    confirm &quot;Paid in full&quot; if every order in the
                    selection was actually collected.
                  </p>
                  <div
                    role="radiogroup"
                    aria-label="Payment status"
                    className="flex flex-wrap gap-2"
                  >
                    {(
                      [
                        ["paid", "Paid in full"],
                        ["partial", "Partial payment"],
                      ] as const
                    ).map(([value, label]) => (
                      <label
                        key={value}
                        className={cn(
                          "flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ring-1",
                          paymentState === value
                            ? "bg-indigo-700 text-white ring-indigo-700"
                            : "bg-white text-indigo-900 ring-indigo-200",
                        )}
                      >
                        <input
                          type="radio"
                          name="bulk-payment-state"
                          value={value}
                          checked={paymentState === value}
                          onChange={() => setPaymentState(value)}
                          className="sr-only"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Label
                      htmlFor="bulk-payment-ref"
                      className="text-[11px] text-indigo-900"
                    >
                      Reference (optional) — check #, transfer ID
                    </Label>
                    <input
                      id="bulk-payment-ref"
                      value={paymentRef}
                      onChange={(e) => setPaymentRef(e.target.value)}
                      maxLength={60}
                      className="w-full rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
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
              {/* El numero que de verdad se va a mover. Prometia `count` (todo
                  lo tildado) mientras el aviso de al lado decia otra cosa y a
                  veces no se movia ninguna: tres cifras distintas en el mismo
                  dialogo. */}
              {busy
                ? `Moving ${movable}…`
                : `Confirm — ${isInvoiceBulk ? "invoice" : "move"} ${movable}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
