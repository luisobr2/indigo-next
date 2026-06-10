"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

interface Props {
  orderId: number;
  /** Stage code (e.g. "design_confirmed") to push the order into. */
  targetStageCode: string;
  /** Button label. */
  label: string;
  /** Icon (defaults to Check). */
  icon?: LucideIcon;
  /** Toast verb shown while moving ("Confirming", "Marking received"). */
  loadingVerb?: string;
  /** Style — primary (filled) or ghost (subtle, for dense tables). */
  variant?: "primary" | "ghost";
}

/**
 * Inline button that performs a single-click stage transition without
 * opening a wizard. Used in stage list rows where the move is
 * unambiguous and the operator would otherwise have to: 1) click into
 * the order, 2) click "Send To", 3) pick the next stage, 4) confirm.
 *
 * Examples:
 *   - Design Approval row → "Confirm Design" (design_pending → design_confirmed)
 *   - Paint row → "Mark Received" (painting → ready_install)
 *
 * Don't use for stages whose wizard captures critical data (SQF, photo,
 * signature) — those still need the full wizard flow.
 */
export function QuickStageActionButton({
  orderId,
  targetStageCode,
  label,
  icon: Icon = Check,
  loadingVerb = "Moving",
  variant = "primary",
}: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  // Stage list is cached widely — we only need it to resolve the code
  // → numeric id once.
  const stagesQ = useQuery<{
    records: Array<{ id: number; name: string; code: string }>;
  }>({
    queryKey: ["stages-list"],
    queryFn: () => fetch("/api/stages").then((r) => r.json()),
    staleTime: 10 * 60_000,
  });

  async function go(e: React.MouseEvent) {
    // Critical: stop bubbling so the row's row-click handler doesn't
    // open the detail page underneath this button.
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;

    const stage = stagesQ.data?.records?.find((s) => s.code === targetStageCode);
    if (!stage) {
      toast.error(`Stage ${targetStageCode} not configured.`);
      return;
    }

    setBusy(true);
    const promise = (async () => {
      const r = await fetch(`/api/orders/${orderId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: stage.id, source: "quick_action" }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Stage move failed");
      qc.invalidateQueries({ queryKey: ["stage-v2"] });
      qc.invalidateQueries({ queryKey: ["stage-v2-stats"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    })().finally(() => setBusy(false));

    toast.promise(promise, {
      loading: `${loadingVerb}…`,
      success: `Moved to ${stage.name}`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  const base =
    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50";
  const cls =
    variant === "primary"
      ? `${base} bg-emerald-600 text-white shadow-sm hover:bg-emerald-700`
      : `${base} border border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-700`;

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy || !stagesQ.data}
      className={cls}
      aria-label={label}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      {label}
    </button>
  );
}
