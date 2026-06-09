"use client";

import { useState } from "react";
import { AlertOctagon, RotateCcw, Package } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface CancelModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  orderId: number;
  orderName: string;
  /** Show the "Restore" variant if the order is already cancelled. */
  restoring?: boolean;
  /**
   * When true the door has already been cut or painted, so we offer the
   * "Move to Available Stock" path in addition to a hard discard.
   */
  finishedDoor?: boolean;
}

type Mode = "discard" | "stock";

export function CancelModal({
  open,
  onClose,
  onSuccess,
  orderId,
  orderName,
  restoring,
  finishedDoor,
}: CancelModalProps) {
  const [mode, setMode] = useState<Mode>(finishedDoor ? "stock" : "discard");
  const [reason, setReason] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const endpoint =
      restoring
        ? `/api/orders/${orderId}/substatus`
        : mode === "stock"
          ? `/api/orders/${orderId}/move-to-stock`
          : `/api/orders/${orderId}/substatus`;
    const payload = restoring
      ? { action: "restore" }
      : mode === "stock"
        ? { label, reason }
        : { action: "cancel", reason };

    const promise = fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
      loading: restoring
        ? "Restoring..."
        : mode === "stock"
          ? "Moving to Available Stock..."
          : "Cancelling...",
      success: restoring
        ? `${orderName} restored`
        : mode === "stock"
          ? `${orderName} → Available Stock`
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
            Order <strong className="text-foreground">{orderName}</strong>{" "}
            {restoring
              ? "will be restored and re-enter the production flow."
              : finishedDoor
                ? "has the door already cut/painted. You can either discard it or keep it in Available Stock for re-use on a future matching order."
                : "will be marked as cancelled and a 'Cancelled' badge will appear in lists."}
          </DialogDescription>
        </DialogHeader>

        {/* Mode picker only when the order has a finished door */}
        {!restoring && finishedDoor && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("stock")}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition",
                mode === "stock"
                  ? "border-indigo-300 bg-indigo-50 ring-2 ring-indigo-200"
                  : "border-slate-200 hover:bg-slate-50",
              )}
            >
              <Package
                size={18}
                className={mode === "stock" ? "text-indigo-700" : "text-slate-500"}
              />
              <span className="text-xs font-semibold">Move to Stock</span>
              <span className="text-[10px] leading-tight text-slate-500">
                Keep the door for re-use
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("discard")}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition",
                mode === "discard"
                  ? "border-rose-300 bg-rose-50 ring-2 ring-rose-200"
                  : "border-slate-200 hover:bg-slate-50",
              )}
            >
              <AlertOctagon
                size={18}
                className={mode === "discard" ? "text-rose-700" : "text-slate-500"}
              />
              <span className="text-xs font-semibold">Discard</span>
              <span className="text-[10px] leading-tight text-slate-500">
                Door is scrap — no stock
              </span>
            </button>
          </div>
        )}

        {!restoring && mode === "stock" && (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="stock-label">Stock nickname</Label>
              <Input
                id="stock-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Bronze SD #3, Karen O'Reilly leftover"
              />
              <p className="text-[10px] text-slate-500">
                The warehouse uses this to find the door later.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="stock-reason">Reason</Label>
              <Textarea
                id="stock-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="e.g. Customer cancelled at the last minute"
              />
            </div>
          </div>
        )}

        {!restoring && mode === "discard" && (
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Wrong measurements — door cannot be reused"
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
            disabled={busy || (!restoring && mode === "stock" && !label.trim())}
            className={cn(
              restoring
                ? "bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700"
                : mode === "stock"
                  ? "bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
                  : "bg-rose-600 text-white shadow shadow-rose-600/30 hover:bg-rose-700",
            )}
          >
            {restoring ? (
              <>
                <RotateCcw size={14} /> Restore
              </>
            ) : mode === "stock" ? (
              <>
                <Package size={14} /> Move to Stock
              </>
            ) : (
              <>
                <AlertOctagon size={14} /> Discard
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
