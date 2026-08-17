"use client";

import { useState, useEffect } from "react";
import { Pause, Play } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Must match indigo.order's hold_cause selection (Odoo 17.0.0.88.0+). */
export type HoldCause = "dealer" | "client" | "other";
const CAUSE_OPTIONS: Array<{ value: HoldCause; label: string }> = [
  { value: "dealer", label: "Dealer — they need to fix/provide something" },
  { value: "client", label: "Client — not available / hasn't confirmed" },
  { value: "other", label: "Other" },
];

interface HoldModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  orderId: number;
  orderName: string;
  /** Show the "Release" variant if the order is already on hold. */
  releasing?: boolean;
  defaultReason?: string;
  defaultCause?: HoldCause;
}

export function HoldModal({
  open,
  onClose,
  onSuccess,
  orderId,
  orderName,
  releasing,
  defaultReason,
  defaultCause,
}: HoldModalProps) {
  const [reason, setReason] = useState(defaultReason ?? "");
  const [cause, setCause] = useState<HoldCause | "">(defaultCause ?? "");
  const [busy, setBusy] = useState(false);

  // The modal stays mounted between opens — reset the fields each time it
  // opens so a stale reason/cause from a previous order isn't submitted by
  // accident.
  useEffect(() => {
    if (open) {
      setReason(defaultReason ?? "");
      setCause(defaultCause ?? "");
    }
  }, [open, defaultReason, defaultCause]);

  // Odoo's indigo.order rejects an on_hold write with no hold_cause (a
  // cause is what makes "7 doors blocked by the dealer" countable — see
  // indigo_order.py's _check_hold_requires_cause), so the button stays
  // disabled until one is picked.
  const canSubmit = releasing || !!cause;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    const promise = fetch(`/api/orders/${orderId}/hold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, release: !!releasing, cause }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        onSuccess();
        onClose();
        return j;
      })
      .finally(() => setBusy(false));

    toast.promise(promise, {
      loading: releasing ? "Releasing..." : "Moving to hold...",
      success: releasing
        ? `${orderName} released`
        : `${orderName} on hold`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {releasing ? (
              <Play size={16} className="text-emerald-600" />
            ) : (
              <Pause size={16} className="text-amber-600" />
            )}
            {releasing ? "Release from hold" : "Move to hold"}
          </DialogTitle>
          <DialogDescription>
            Order <strong className="text-foreground">{orderName}</strong> will be{" "}
            {releasing
              ? "resumed and continue its normal flow."
              : "marked as on hold. It will still show up on the boards but the chatter will note the reason."}
          </DialogDescription>
        </DialogHeader>

        {!releasing && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="hold-cause">
                Who's blocking this? <span className="text-rose-600">*</span>
              </Label>
              <Select value={cause} onValueChange={(v) => setCause(v as HoldCause)}>
                <SelectTrigger id="hold-cause" className="h-9 w-full">
                  <SelectValue placeholder="Select a cause..." />
                </SelectTrigger>
                <SelectContent>
                  {CAUSE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Drives the dealer/client counters and colors on the Installations screen.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hold-reason">Reason (detail)</Label>
              <Textarea
                id="hold-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Dealer needs to confirm the color change before we cut"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy || !canSubmit}
            className={
              releasing
                ? "bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700"
                : "bg-amber-600 text-white shadow shadow-amber-600/30 hover:bg-amber-700"
            }
          >
            {releasing ? <Play size={14} /> : <Pause size={14} />}
            {busy ? "..." : releasing ? "Release" : "Move to hold"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
