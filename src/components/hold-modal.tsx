"use client";

import { useState } from "react";
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

interface HoldModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  orderId: number;
  orderName: string;
  /** Show the "Release" variant if the order is already on hold. */
  releasing?: boolean;
  defaultReason?: string;
}

export function HoldModal({
  open,
  onClose,
  onSuccess,
  orderId,
  orderName,
  releasing,
  defaultReason,
}: HoldModalProps) {
  const [reason, setReason] = useState(defaultReason ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const promise = fetch(`/api/orders/${orderId}/hold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, release: !!releasing }),
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
          <div className="space-y-1.5">
            <Label htmlFor="hold-reason">Reason</Label>
            <Textarea
              id="hold-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Customer asked to postpone install until next week"
            />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy}
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
