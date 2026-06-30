"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Truck, CheckCircle2, CalendarX } from "lucide-react";
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
import { Input } from "@/components/ui/input";
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

export interface ScheduleTarget {
  id: number;
  /** Order label for the dialog header (dealer_ref or name). */
  label: string;
  clientName: string;
  /** Installer ids already on the order, to pre-check. */
  installerIds?: number[];
  /** True when the order is already on the calendar (enables "Remove from
   *  calendar"). Set it from Reschedule / calendar-event triggers. */
  scheduled?: boolean;
  /** Current installation date (YYYY-MM-DD) to pre-fill when rescheduling. */
  date?: string;
}

function todayYmd() {
  // Local date (not UTC) so the default lands on the operator's today.
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

/**
 * Schedule an installation in one step: pick a date + installer(s) and the
 * order moves to "Installation Scheduled". Reuses /api/contractors for the
 * installer list and POSTs to /api/orders/:id/schedule.
 */
export function ScheduleInstallationModal({
  target,
  onClose,
}: {
  target: ScheduleTarget | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const open = target !== null;
  const [date, setDate] = useState(todayYmd());
  const [installerIds, setInstallerIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  // Reset the form each time a new order is opened.
  useEffect(() => {
    if (target) {
      // When rescheduling, pre-fill the existing date so it isn't moved to
      // today by accident; otherwise default to today for a fresh schedule.
      const d = target.date && /^\d{4}-\d{2}-\d{2}/.test(target.date) ? target.date.slice(0, 10) : todayYmd();
      setDate(d);
      setInstallerIds(target.installerIds ?? []);
    }
  }, [target]);

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
    if (!target) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("Pick an installation date");
      return;
    }
    setBusy(true);
    const promise = fetch(`/api/orders/${target.id}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installation_date: date, installer_ids: installerIds }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        qc.invalidateQueries({ queryKey: ["installers-dashboard"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        onClose();
      })
      .finally(() => setBusy(false));

    toast.promise(promise, {
      loading: "Scheduling…",
      success: "Installation scheduled",
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  async function unschedule() {
    if (!target) return;
    if (!confirm("Remove this installation from the calendar? It goes back to Pending Scheduling.")) return;
    setBusy(true);
    const promise = fetch(`/api/orders/${target.id}/unschedule`, { method: "POST" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        qc.invalidateQueries({ queryKey: ["installers-dashboard"] });
        qc.invalidateQueries({ queryKey: ["calendar"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        onClose();
      })
      .finally(() => setBusy(false));
    toast.promise(promise, {
      loading: "Removing…",
      success: "Removed from calendar",
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
            {target ? (
              <>
                {target.label} · {target.clientName}. Sets the date and moves
                the order to <strong>Installation Scheduled</strong>.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="install-date">Installation date</Label>
            <Input
              id="install-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Truck size={13} className="text-slate-400" /> Installers
            </Label>
            {installers.length === 0 ? (
              <p className="text-xs text-slate-500">
                No installers found. Add one from the Installations page first,
                or schedule now and assign later.
              </p>
            ) : (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
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
              Optional — you can assign or change installers later.
            </p>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {target?.scheduled ? (
            <Button
              type="button"
              variant="outline"
              onClick={unschedule}
              disabled={busy}
              className="border-rose-200 text-rose-700 hover:bg-rose-50"
            >
              <CalendarX size={14} />
              Remove from calendar
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={busy}
              className="bg-amber-600 text-white shadow shadow-amber-600/30 hover:bg-amber-700"
            >
              <CheckCircle2 size={14} />
              {busy ? "Saving…" : target?.scheduled ? "Reschedule" : "Schedule"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
