"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, X, Check, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { STAGE_BADGE as STAGE_BADGE_COLOR } from "@/lib/labels";
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
  orderId: number;
  orderName: string;
  currentStageCode: string;
  stages: Stage[];
  onSuccess?: () => void;
  /**
   * Controls the trigger button styling:
   *   "header"  — compact indigo CTA for the Order Detail toolbar (default).
   *   "panel"   — full-width pill so it lines up with the Hold / Cancel
   *               buttons in the SidePanel actions column. The visual
   *               weight is lower than the panel's PRIMARY action
   *               (Start CNC, Mark done) — we use outline + indigo text
   *               instead of solid indigo to avoid two "primary"
   *               buttons fighting for attention.
   */
  variant?: "header" | "panel";
}

// Friendly groupings so Majela's "go to ANY stage" mental model maps to
// the production flow. Keys are the codes that show up in indigo.stage.
const STAGE_GROUPS: Array<{
  label: string;
  codes: string[];
}> = [
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


export function SendToDropdown({
  orderId,
  orderName,
  currentStageCode,
  stages,
  onSuccess,
  variant = "header",
}: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Stage | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const byCode = new Map(stages.map((s) => [s.code, s]));

  function pick(stage: Stage) {
    setTarget(stage);
    setNote("");
  }

  async function send() {
    if (!target) return;
    setBusy(true);
    const promise = fetch(`/api/orders/${orderId}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage_id: target.id,
        note,
        source: "Send To",
      }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        qc.invalidateQueries({ queryKey: ["order", String(orderId)] });
        qc.invalidateQueries({ queryKey: ["order-timeline", orderId] });
        qc.invalidateQueries({ queryKey: ["order-activity", orderId] });
        // Close BEFORE the parent's onSuccess unmounts us, otherwise
        // React warns about a state update on the unmounted component.
        setOpen(false);
        setTarget(null);
        onSuccess?.();
        return j;
      })
      .finally(() => setBusy(false));

    toast.promise(promise, {
      loading: `Sending ${orderName} to ${target.name}…`,
      success: `${orderName} → ${target.name}`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  return (
    <>
      {variant === "header" ? (
        <Button
          onClick={() => setOpen(true)}
          size="lg"
          className="bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
        >
          <Send size={14} />
          Send to…
          <ArrowRight size={14} />
        </Button>
      ) : (
        <Button
          onClick={() => setOpen(true)}
          variant="outline"
          size="lg"
          className="h-11 w-full justify-between border-indigo-200 text-indigo-700 hover:bg-indigo-50/40"
        >
          <span className="flex items-center gap-2">
            <Send size={14} />
            Send to…
          </span>
          <ArrowRight size={14} />
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setOpen(false);
            setTarget(null);
            setNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send size={16} className="text-indigo-700" />
              Send order to…
            </DialogTitle>
            <DialogDescription>
              Pick the stage to move <strong>{orderName}</strong> into.
              Skipping ahead or going back is fine — every move is logged
              in the change history.
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
                      {options.map((s) => {
                        const isCurrent = s.code === currentStageCode;
                        return (
                          <li key={s.id}>
                            <button
                              type="button"
                              onClick={() => !isCurrent && pick(s)}
                              disabled={isCurrent}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left transition",
                                isCurrent
                                  ? "cursor-not-allowed bg-slate-50 opacity-70"
                                  : "hover:border-indigo-300 hover:bg-indigo-50/40",
                              )}
                            >
                              <span
                                className={cn(
                                  "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                  STAGE_BADGE_COLOR[s.code] ?? "bg-slate-100 text-slate-700",
                                )}
                              >
                                {s.name}
                              </span>
                              {isCurrent && (
                                <span className="text-[10px] font-medium text-slate-500">
                                  Current stage
                                </span>
                              )}
                              <ArrowRight
                                size={14}
                                className="ml-auto text-slate-300"
                              />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 px-3 py-2 text-sm">
                <span className="text-slate-500">Sending to: </span>
                <strong className="text-indigo-800">{target.name}</strong>
              </div>
              <div className="space-y-1">
                <Label htmlFor="send-note">Note (optional)</Label>
                <Textarea
                  id="send-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Reason for the move — appears in the change history."
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
              <Check size={14} /> Confirm send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
