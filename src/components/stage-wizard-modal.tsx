"use client";

import { useRef, useState } from "react";
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
  /** Optional measurements/SQF table fields */
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

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      if (note) payload.note = note;
      if (config.withAmount && amount)
        payload.amount_collected = parseFloat(amount);
      if (config.withPhoto && photoFile)
        payload.photo = await fileToBase64(photoFile);
      if (config.withSignature) {
        const sigData = sigRef.current?.getDataURL();
        if (sigData) payload.signature = sigData;
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
              <Input
                id="wizard-photo"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
              />
              {photoFile && (
                <p className="text-xs text-emerald-700">✓ {photoFile.name}</p>
              )}
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
            disabled={busy}
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
