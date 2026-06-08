"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brush, Truck, UserPlus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Contractor {
  id: number;
  name: string;
  login: string;
}

interface ContractorsResponse {
  painters: Contractor[];
  installers: Contractor[];
}

interface AssignmentCardProps {
  orderId: number;
  /** Current painter — Odoo m2o tuple. */
  painter: { id: number; name: string } | null;
  /** Current installers — array of m2o tuples. */
  installers: Array<{ id: number; name: string }>;
  /** True if the viewer can edit (Manager/Office). */
  canEdit: boolean;
}

export function AssignmentCard({
  orderId,
  painter,
  installers,
  canEdit,
}: AssignmentCardProps) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftPainterId, setDraftPainterId] = useState<number | null>(
    painter?.id ?? null,
  );
  const [draftInstallerIds, setDraftInstallerIds] = useState<number[]>(
    installers.map((i) => i.id),
  );

  // Prefetch as soon as the card mounts so the Select doesn't briefly show
  // raw numeric IDs while contractors load.
  const { data: contractors } = useQuery<ContractorsResponse>({
    queryKey: ["contractors"],
    queryFn: () => fetch("/api/contractors").then((r) => r.json()),
    staleTime: 5 * 60_000,
    enabled: canEdit,
  });

  function startEdit() {
    setDraftPainterId(painter?.id ?? null);
    setDraftInstallerIds(installers.map((i) => i.id));
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
  }

  async function save() {
    setBusy(true);
    const promise = fetch(`/api/orders/${orderId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        painter_id: draftPainterId,
        installer_ids: draftInstallerIds,
      }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        qc.invalidateQueries({ queryKey: ["order", String(orderId)] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        setEditing(false);
      })
      .finally(() => setBusy(false));

    toast.promise(promise, {
      loading: "Saving assignment...",
      success: "Assignment saved",
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  function toggleInstaller(id: number) {
    setDraftInstallerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          <UserPlus size={14} className="text-indigo-700" />
          Assigned contractors
        </div>
        {canEdit && !editing && (
          <Button variant="outline" size="xs" onClick={startEdit}>
            Edit
          </Button>
        )}
      </div>

      {!editing ? (
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-2">
            <Brush size={14} className="mt-0.5 shrink-0 text-orange-600" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Painter
              </div>
              {painter ? (
                <div className="font-semibold text-slate-800">{painter.name}</div>
              ) : (
                <div className="text-xs italic text-slate-400">
                  Unassigned — no payout will be generated.
                </div>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Truck size={14} className="mt-0.5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Installer(s)
              </div>
              {installers.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {installers.map((i) => (
                    <Badge
                      key={i.id}
                      variant="secondary"
                      className="bg-emerald-50 text-emerald-700"
                    >
                      {i.name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="text-xs italic text-slate-400">
                  Unassigned — no installer payout will be generated.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Painter
            </label>
            <Select
              value={draftPainterId ? String(draftPainterId) : "none"}
              onValueChange={(v) =>
                setDraftPainterId(v === "none" ? null : Number(v))
              }
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Select painter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Unassigned —</SelectItem>
                {contractors?.painters?.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Installer(s) — pick one or more
            </label>
            {(contractors?.installers ?? []).length === 0 ? (
              <p className="text-xs text-slate-400">Loading…</p>
            ) : (
              <ul className="space-y-1.5">
                {contractors?.installers?.map((i) => {
                  const checked = draftInstallerIds.includes(i.id);
                  return (
                    <li key={i.id}>
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 transition hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleInstaller(i.id)}
                          className="rounded"
                        />
                        <span className="text-sm text-slate-800">{i.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={cancel}
              disabled={busy}
            >
              <X size={14} />
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              <Save size={14} />
              Save
            </Button>
          </div>
        </div>
      )}

      {(!painter || installers.length === 0) && !editing && canEdit && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
          ⚠ When the order leaves Painting / reaches Installed, the system
          auto-creates contractor payouts. Without an assignment here, no
          payout is generated.
        </p>
      )}
    </div>
  );
}
