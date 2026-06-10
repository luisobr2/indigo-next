"use client";

import { useState } from "react";
import { Send, X, ArrowRight, Check } from "lucide-react";
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

const STAGE_BADGE_COLOR: Record<string, string> = {
  new: "bg-slate-100 text-slate-700",
  design_pending: "bg-amber-50 text-amber-700",
  design_confirmed: "bg-emerald-50 text-emerald-700",
  measure_pending: "bg-amber-50 text-amber-700",
  measured: "bg-emerald-50 text-emerald-700",
  ready_digitalization: "bg-sky-50 text-sky-700",
  cnc: "bg-violet-50 text-violet-700",
  painting: "bg-orange-50 text-orange-700",
  ready_install: "bg-blue-50 text-blue-700",
  install_scheduled: "bg-blue-50 text-blue-700",
  installed: "bg-emerald-50 text-emerald-700",
  invoiced: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-500",
};

/**
 * Bulk "Move Selected To" button. Shown next to the "N selected" chip
 * on every list screen so the user can mass-route approved orders to
 * Measurements / Digitalization / wherever in a single click.
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

  const byCode = new Map(stages.map((s) => [s.code, s]));
  const count = orderIds.length;

  function reset() {
    setOpen(false);
    setTarget(null);
    setNote("");
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

    // Refresh decisions are delegated to the parent: only it knows the
    // right queryKey for the screen it lives on (/orders uses
    // ["orders"], stage screens use ["stage-v2", ...]).
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      toast.success(`Moved ${count} orders to ${target.name}`);
      reset();
      onSuccess?.();
      return;
    }
    if (failed === count) {
      toast.error(
        `All ${count} moves failed. Stage write rejected by Odoo.`,
        { duration: 7000 },
      );
      // keep modal open so the user can retry
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

  // Hide when nothing's ticked or when the stages query hasn't resolved
  // yet — opening the modal with an empty list would surface as an
  // ALL-BLANK picker (every group filters to no options) which looks
  // broken. Wait until /api/stages returns before exposing the action.
  if (!count || !stages.length) return null;

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
              still get moved — un-cancel them or release from stock
              first if that&apos;s not what you want.
            </DialogDescription>
          </DialogHeader>

          {!target ? (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
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
                                STAGE_BADGE_COLOR[s.code] ?? "bg-slate-100 text-slate-700",
                              )}
                            >
                              {s.name}
                            </span>
                            <ArrowRight size={14} className="ml-auto text-slate-300" />
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
                onClick={() => setTarget(null)}
                disabled={busy}
              >
                <X size={14} /> Pick another stage
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={send}
              disabled={!target || busy}
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
