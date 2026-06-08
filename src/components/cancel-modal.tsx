"use client";

import { useState } from "react";
import { AlertOctagon, RotateCcw } from "lucide-react";
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

interface CancelModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  orderId: number;
  orderName: string;
  /** Show the "Restore" variant if the order is already cancelled. */
  restoring?: boolean;
}

export function CancelModal({
  open,
  onClose,
  onSuccess,
  orderId,
  orderName,
  restoring,
}: CancelModalProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const promise = fetch(`/api/orders/${orderId}/substatus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        restoring
          ? { action: "restore" }
          : { action: "cancel", reason },
      ),
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
      loading: restoring ? "Restoring..." : "Cancelling...",
      success: restoring
        ? `${orderName} restored`
        : `${orderName} cancelled`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {restoring ? (
              <RotateCcw size={16} className="text-emerald-600" />
            ) : (
              <AlertOctagon size={16} className="text-rose-600" />
            )}
            {restoring ? "Restore cancelled order" : "Cancel order"}
          </DialogTitle>
          <DialogDescription>
            Order <strong className="text-foreground">{orderName}</strong> will be{" "}
            {restoring
              ? "restored and re-enter the production flow."
              : "marked as cancelled. The reason will be logged in chatter and a 'Cancelled' badge will appear in lists."}
          </DialogDescription>
        </DialogHeader>

        {!restoring && (
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Customer cancelled at the last minute due to wrong measurements"
            />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy}
            className={
              restoring
                ? "bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700"
                : "bg-rose-600 text-white shadow shadow-rose-600/30 hover:bg-rose-700"
            }
          >
            {restoring ? <RotateCcw size={14} /> : <AlertOctagon size={14} />}
            {busy ? "..." : restoring ? "Restore" : "Cancel order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
