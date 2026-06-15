"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Truck, CheckCircle2 } from "lucide-react";
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

interface Contractor {
  id: number;
  name: string;
  login: string;
}
interface ContractorsResponse {
  painters: Contractor[];
  installers: Contractor[];
}

export interface PendingOrder {
  id: number;
  name: string;
  dealer_ref: string;
  client_name: string;
  installer_ids: number[];
}

function prettyDate(ymd: string) {
  // Parse as local date (avoid TZ shift) for the header.
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Schedule an installation onto a specific calendar day: pick one of the
 * pending (undated) orders and optionally its installers. POSTs to the
 * existing /api/orders/:id/schedule endpoint with the clicked date.
 */
export function ScheduleOnDayModal({
  date,
  pending,
  onClose,
  onScheduled,
}: {
  /** Clicked day as YYYY-MM-DD, or null when closed. */
  date: string | null;
  pending: PendingOrder[];
  onClose: () => void;
  onScheduled: () => void;
}) {
  const qc = useQueryClient();
  const open = date !== null;
  const [orderId, setOrderId] = useState<number | null>(null);
  const [installerIds, setInstallerIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => pending.find((p) => p.id === orderId) ?? null,
    [pending, orderId],
  );

  // Reset when reopened; preselect installers from the chosen order.
  useEffect(() => {
    if (open) {
      setOrderId(null);
      setInstallerIds([]);
    }
  }, [open, date]);

  useEffect(() => {
    setInstallerIds(selected?.installer_ids ?? []);
  }, [selected]);

  const { data: contractors } = useQuery<ContractorsResponse>({
    queryKey: ["contractors"],
    queryFn: () => fetch("/api/contractors").then((r) => r.json()),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  function toggle(id: number) {
    setInstallerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function submit() {
    if (!date || !orderId) {
      toast.error("Pick an order to schedule");
      return;
    }
    setBusy(true);
    const promise = fetch(`/api/orders/${orderId}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installation_date: date, installer_ids: installerIds }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        qc.invalidateQueries({ queryKey: ["calendar"] });
        qc.invalidateQueries({ queryKey: ["installers-dashboard"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        onScheduled();
        onClose();
      })
      .finally(() => setBusy(false));

    toast.promise(promise, {
      loading: "Scheduling…",
      success: "Installation scheduled",
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  const installers = contractors?.installers ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar size={16} className="text-amber-600" />
            Schedule installation
          </DialogTitle>
          <DialogDescription>
            {date ? prettyDate(date) : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="order-pick">Order to schedule</Label>
            {pending.length === 0 ? (
              <p className="text-xs text-slate-500">
                No installations are waiting to be scheduled.
              </p>
            ) : (
              <select
                id="order-pick"
                value={orderId ?? ""}
                onChange={(e) =>
                  setOrderId(e.target.value ? Number(e.target.value) : null)
                }
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">Select an order…</option>
                {pending.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.dealer_ref || p.name)} — {p.client_name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selected && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Truck size={13} className="text-slate-400" /> Installers
              </Label>
              {installers.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No installers found. You can schedule now and assign later.
                </p>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
                  {installers.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={installerIds.includes(p.id)}
                        onChange={() => toggle(p.id)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                      />
                      <span className="text-slate-700">{p.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-400">
                Optional — you can change installers later.
              </p>
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
            disabled={busy || !orderId}
            className="bg-amber-600 text-white shadow shadow-amber-600/30 hover:bg-amber-700"
          >
            <CheckCircle2 size={14} />
            {busy ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
