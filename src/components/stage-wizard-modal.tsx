"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, FileSignature } from "lucide-react";
import { toast } from "sonner";
import { SignaturePad, SignaturePadHandle } from "./signature-pad";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface StageWizardConfig {
  /** Odoo wizard model id, e.g. "indigo.painter.done.wizard" */
  wizard: string;
  title: string;
  description: string;
  /** Primary action label shown on the submit button */
  submitLabel: string;
  /** Optional photo upload field (Mark painted / Mark installed) */
  withPhoto?: boolean;
  /** Optional signature canvas (Mark installed) */
  withSignature?: boolean;
  /** Optional amount field for the Invoice & paid wizard */
  withAmount?: boolean;
  /**
   * If true, fetches order lines and renders a per-line SQF input table.
   * On submit the values are written to indigo.order.line before the
   * wizard fires. Used by the digitization wizard.
   */
  withSqfTable?: boolean;
  noteLabel?: string;
}

interface StageWizardModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  orderId: number;
  orderName: string;
  config: StageWizardConfig;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function StageWizardModal({
  open,
  onClose,
  onSuccess,
  orderId,
  orderName,
  config,
}: StageWizardModalProps) {
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);

  interface SqfLine {
    id: number;
    design_id: [number, string] | false;
    door_type: string | false;
    width_label: string | false;
    height_label: string | false;
    qty: number;
    sqf: number;
  }
  const [sqfLines, setSqfLines] = useState<SqfLine[]>([]);

  // Track painter/installer assignment for wizards that require them.
  // Lets us block submission with a clear message instead of silently
  // letting the stage advance create no payout.
  const requiresPainter = config.wizard === "indigo.painter.done.wizard";
  const requiresInstaller = config.wizard === "indigo.installed.wizard";
  const needsOrderFetch =
    config.withSqfTable || requiresPainter || requiresInstaller;

  const [assignment, setAssignment] = useState<{
    painter: [number, string] | false;
    installerCount: number;
  } | null>(null);

  // Pull the order whenever the wizard mounts in a mode that needs the
  // order's lines (SQF) or its painter/installer assignment.
  useEffect(() => {
    if (!open || !needsOrderFetch) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/orders/${orderId}`);
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        if (config.withSqfTable) {
          const lines = (j.lines ?? []) as SqfLine[];
          setSqfLines(lines.map((l) => ({ ...l, sqf: Number(l.sqf) || 0 })));
        }
        const order = j.order ?? {};
        setAssignment({
          painter: order.painter_id ?? false,
          installerCount: Array.isArray(order.installer_ids)
            ? order.installer_ids.length
            : 0,
        });
      } catch {
        /* surfaced on submit if needed */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, needsOrderFetch, config.withSqfTable, orderId]);

  const missingAssignment =
    (requiresPainter && assignment !== null && !assignment.painter) ||
    (requiresInstaller && assignment !== null && assignment.installerCount === 0);

  function updateLineSqf(lineId: number, sqf: number) {
    setSqfLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, sqf } : l)),
    );
  }

  const sqfTotal = sqfLines.reduce((s, l) => s + (Number(l.sqf) || 0), 0);

  async function submit() {
    setError(null);
    // Amount is required (and must be > 0) for the invoice/paid wizard —
    // otherwise the order advances to "Paid" with $0 collected.
    if (config.withAmount) {
      const amt = parseFloat(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        setError("Enter the amount collected (greater than 0).");
        return;
      }
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      if (note) payload.note = note;
      if (config.withAmount)
        payload.amount_collected = parseFloat(amount);
      if (config.withPhoto && photoFile)
        payload.photo = await fileToBase64(photoFile);
      if (config.withSignature) {
        const sigData = sigRef.current?.getDataURL();
        if (sigData) payload.signature = sigData;
      }
      if (config.withSqfTable && sqfLines.length) {
        const line_sqfs: Record<string, number> = {};
        for (const l of sqfLines) line_sqfs[String(l.id)] = Number(l.sqf) || 0;
        payload.line_sqfs = line_sqfs;
      }

      const r = await fetch(`/api/orders/${orderId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wizard: config.wizard, payload }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to advance stage");
      toast.success(`${orderName} — ${config.title.toLowerCase()} saved`, {
        description: "Stage advanced and chatter updated.",
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>
            Order <span className="font-semibold text-foreground">{orderName}</span> — {config.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {missingAssignment && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <div className="font-semibold uppercase tracking-wide text-amber-700">
                ⚠ Assignment missing
              </div>
              <p className="mt-1">
                {requiresPainter
                  ? "This order has no painter assigned. Advancing now would skip the painter payout."
                  : "This order has no installer assigned. Advancing now would skip the installer payout."}
                {" "}
                Close this wizard, click <strong>Edit</strong> on the
                Assigned Contractors card and pick a contractor before
                marking the order complete.
              </p>
            </div>
          )}
          {config.withAmount && (
            <div className="space-y-1.5">
              <Label htmlFor="wizard-amount">Amount collected (USD)</Label>
              <Input
                id="wizard-amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}

          {config.withPhoto && (
            <div className="space-y-1.5">
              <Label htmlFor="wizard-photo" className="flex items-center gap-2">
                <Camera size={12} />
                Photo (optional)
              </Label>
              {/* Native input — Base UI Input wrapper breaks the file picker. */}
              <label
                htmlFor="wizard-photo"
                className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 transition hover:bg-slate-50"
              >
                <Camera size={14} className="text-indigo-600" />
                {photoFile ? (
                  <span className="truncate text-slate-900">{photoFile.name}</span>
                ) : (
                  <span>Choose photo…</span>
                )}
              </label>
              <input
                id="wizard-photo"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </div>
          )}

          {config.withSignature && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-2">
                <FileSignature size={12} />
                Customer signature
              </Label>
              <SignaturePad ref={sigRef} height={150} />
            </div>
          )}

          {config.withSqfTable && (
            <div className="space-y-1.5">
              <Label>SQF per piece</Label>
              {sqfLines.length === 0 ? (
                <p className="text-xs italic text-slate-400">Loading pieces…</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Design</th>
                        <th className="px-2 py-1.5 text-left">Type</th>
                        <th className="px-2 py-1.5 text-right">W × H</th>
                        <th className="px-2 py-1.5 text-right">Qty</th>
                        <th className="px-2 py-1.5 text-right">SQF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sqfLines.map((l) => {
                        const design = Array.isArray(l.design_id)
                          ? l.design_id[1]
                          : "—";
                        return (
                          <tr key={l.id} className="border-t border-slate-100">
                            <td className="px-2 py-1.5 text-slate-700">{design}</td>
                            <td className="px-2 py-1.5 text-slate-600">{l.door_type || "—"}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">
                              {(l.width_label || "?") + " × " + (l.height_label || "?")}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{l.qty}</td>
                            <td className="px-1 py-1 text-right">
                              <Input
                                type="number"
                                step="0.01"
                                value={l.sqf || ""}
                                onChange={(e) =>
                                  updateLineSqf(l.id, Number(e.target.value))
                                }
                                className="h-7 w-20 text-right tabular-nums"
                              />
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t border-slate-200 bg-slate-50">
                        <td colSpan={4} className="px-2 py-1.5 text-right font-semibold text-slate-700">
                          Total
                        </td>
                        <td className="px-2 py-1.5 text-right text-sm font-bold text-indigo-700">
                          {sqfTotal.toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="wizard-note">{config.noteLabel ?? "Note (optional)"}</Label>
            <Textarea
              id="wizard-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Any noteworthy detail..."
            />
          </div>

          {error && (
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy || missingAssignment}
            className="bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
          >
            <CheckCircle2 size={14} />
            {busy ? "Saving..." : config.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lookup table for stage → wizard config so callers don't repeat copy. */
export const STAGE_WIZARDS: Record<string, StageWizardConfig> = {
  measure_pending: {
    wizard: "indigo.measurement.entry.wizard",
    title: "Enter measurements",
    description:
      "Confirm that the door measurements have been taken. The order will move to Measured.",
    submitLabel: "Save & advance to Measured",
  },
  ready_digitalization: {
    wizard: "indigo.sqf.entry.wizard",
    title: "Enter SQF",
    description:
      "Enter the SQF you got from your CorelDraw plugin for each piece. Order moves to CNC.",
    submitLabel: "Save & advance to CNC",
    withSqfTable: true,
  },
  cnc: {
    wizard: "indigo.cnc.done.wizard",
    title: "Mark CNC done",
    description: "Confirm cutting is done. The order moves to Painting.",
    submitLabel: "Save & advance to Painting",
    noteLabel: "Note (e.g. broken bit, redid piece 2)",
  },
  painting: {
    wizard: "indigo.painter.done.wizard",
    title: "Mark painted",
    description:
      "Confirm pieces are painted. Order moves to Ready for Installation.",
    submitLabel: "Save & advance to Ready for Installation",
    withPhoto: true,
  },
  install_scheduled: {
    wizard: "indigo.installed.wizard",
    title: "Mark installed",
    description:
      "Snap a photo and have the customer sign. Order moves to Installed.",
    submitLabel: "Save & advance to Installed",
    withPhoto: true,
    withSignature: true,
  },
  installed: {
    wizard: "indigo.invoiced.paid.wizard",
    title: "Invoice and mark paid",
    description:
      "Record the amount collected and move the order to Invoiced / Paid.",
    submitLabel: "Save & advance to Invoiced/Paid",
    withAmount: true,
    noteLabel: "Reference (check #, transfer ID...)",
  },
};
