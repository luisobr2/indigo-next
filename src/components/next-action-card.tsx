"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  DollarSign,
  Loader2,
  Phone,
  Wand2,
  Ruler,
  PauseCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  orderId: number;
  stageCode: string;
  onHold: boolean;
  paymentState: string;
  /**
   * When the current stage has a wizard configured, the host passes
   * this callback so the "Open wizard" CTA can trigger it. If absent,
   * the wizard CTA hides.
   */
  onOpenWizard?: () => void;
  wizardLabel?: string;
}

interface Recipe {
  icon: LucideIcon;
  tone: "neutral" | "warn" | "ok" | "money";
  title: string;
  hint?: string;
  /** Optional CTA label that triggers the wizard. */
  cta?: string;
}

/**
 * Maps a stage code to the human-meaningful "what's the next move?".
 * Drives the Next Action card on Order detail. The CTA is omitted when
 * the move is *not* immediately actionable from this page (e.g. waiting
 * on the client to reply, or work that happens in a different screen).
 */
const RECIPES: Record<string, Recipe> = {
  new: {
    icon: Phone,
    tone: "neutral",
    title: "Confirm the order with the client",
    hint: "Reach out by phone or WhatsApp. Once confirmed, send to Design or Measurement.",
  },
  design_pending: {
    icon: Phone,
    tone: "warn",
    title: "Awaiting client design approval",
    hint: "Chase the dealer / client and confirm the chosen design and finish.",
    cta: "Confirm design",
  },
  design_confirmed: {
    icon: Ruler,
    tone: "ok",
    title: "Send to Measurements",
    hint: "Schedule Javier to take dimensions on site.",
  },
  measure_pending: {
    icon: Ruler,
    tone: "warn",
    title: "Schedule a measurement visit",
    hint: "Add the address to Javier's route for the day.",
  },
  measured: {
    icon: ArrowRight,
    tone: "ok",
    title: "Ready to start digitalization",
    hint: "Send the order to the designer to generate the CNC file.",
  },
  ready_digitalization: {
    icon: Wand2,
    tone: "warn",
    title: "Capture SQF and produce the CNC file",
    hint: "Open the wizard to enter SQF, attach the CNC artwork, and route to CNC.",
    cta: "Open Digitalization wizard",
  },
  cnc: {
    icon: Wand2,
    tone: "warn",
    title: "Cut the pieces, then send to Painting",
    hint: "Mark CNC complete in the wizard when the cut is finished.",
    cta: "Open CNC wizard",
  },
  painting: {
    icon: Wand2,
    tone: "warn",
    title: "Painter has the pieces",
    hint: "Once the pieces come back, mark received from the Paint screen or here.",
    cta: "Open Painting wizard",
  },
  ready_install: {
    icon: ArrowRight,
    tone: "ok",
    title: "Ready to schedule installation",
    hint: "Pick a date and assign an installer.",
  },
  install_scheduled: {
    icon: Phone,
    tone: "neutral",
    title: "Installation scheduled — confirm with the client",
    hint: "Add to the route planner the day before and send the reminder.",
    cta: "Open Installation wizard",
  },
  installed: {
    icon: DollarSign,
    tone: "money",
    title: "Installed — time to invoice the dealer",
    hint: "Generate the invoice and mark payment when received.",
  },
  invoiced: {
    icon: DollarSign,
    tone: "money",
    title: "Awaiting payment from dealer",
    hint: "Use Mark as Paid once funds clear.",
  },
  closed: {
    icon: CheckCircle2,
    tone: "ok",
    title: "Closed — no action needed",
  },
};

const TONE_BG: Record<Recipe["tone"], string> = {
  neutral: "bg-slate-50 ring-slate-200",
  warn: "bg-amber-50 ring-amber-200",
  ok: "bg-emerald-50 ring-emerald-200",
  money: "bg-violet-50 ring-violet-200",
};

const TONE_ICON_BG: Record<Recipe["tone"], string> = {
  neutral: "bg-slate-100 text-slate-700",
  warn: "bg-amber-100 text-amber-700",
  ok: "bg-emerald-100 text-emerald-700",
  money: "bg-violet-100 text-violet-700",
};

export function NextActionCard({
  orderId,
  stageCode,
  onHold,
  paymentState,
  onOpenWizard,
  wizardLabel,
}: Props) {
  const qc = useQueryClient();
  const [markingPaid, setMarkingPaid] = useState(false);

  // On hold short-circuits the recipe — the only sensible next step is
  // to take it off hold (handled by Send To dropdown, but we explain
  // why we're not nagging about the underlying stage).
  if (onHold) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 px-5 py-4 ring-1 ring-amber-200">
        <div className="rounded-xl bg-amber-100 p-2 text-amber-700">
          <PauseCircle size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-900">
            On Hold — pick this up before any other action
          </div>
          <div className="text-xs text-amber-800/80">
            Use Send To to resume the order.
          </div>
        </div>
      </div>
    );
  }

  const recipe = RECIPES[stageCode];
  // Unknown stage → graceful empty (don't render a confusing default).
  if (!recipe) return null;

  const Icon = recipe.icon;
  const showWizardCta = !!(recipe.cta && onOpenWizard);
  // Show "Mark as Paid" on installed/invoiced when not already paid.
  // We deliberately keep this scoped — earlier stages aren't usually
  // ready for payment and showing the button there is confusing.
  const showMarkPaid =
    paymentState !== "paid" &&
    (stageCode === "installed" || stageCode === "invoiced");

  async function markPaid() {
    if (markingPaid) return;
    if (!confirm("Mark this order as paid? This is recorded in the chatter.")) return;
    setMarkingPaid(true);
    const promise = (async () => {
      const r = await fetch(`/api/orders/${orderId}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "paid" }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["order", String(orderId)] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["order-activity", orderId] });
    })().finally(() => setMarkingPaid(false));
    toast.promise(promise, {
      loading: "Marking as paid…",
      success: "Order marked as paid",
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-2xl px-5 py-4 ring-1 ${TONE_BG[recipe.tone]}`}
    >
      <div className={`rounded-xl p-2 ${TONE_ICON_BG[recipe.tone]}`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Next action
        </div>
        <div className="text-sm font-semibold text-slate-900">
          {recipe.title}
        </div>
        {recipe.hint && (
          <div className="text-xs text-slate-600">{recipe.hint}</div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {showWizardCta && (
          <button
            type="button"
            onClick={onOpenWizard}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-2 text-xs font-semibold text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
          >
            <ArrowRight size={14} />
            {wizardLabel || recipe.cta}
          </button>
        )}
        {showMarkPaid && (
          <button
            type="button"
            onClick={markPaid}
            disabled={markingPaid}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow shadow-emerald-600/30 hover:bg-emerald-700 disabled:opacity-60"
          >
            {markingPaid ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <DollarSign size={14} />
            )}
            Mark as Paid
          </button>
        )}
      </div>
    </div>
  );
}
