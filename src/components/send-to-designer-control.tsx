"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Designer {
  id: number;
  name: string;
  email: string;
}

interface SendToDesignerControlProps {
  orderId: number;
  /** Current designer_id on the order, if already assigned — Odoo m2o tuple. */
  currentDesignerId?: [number, string] | false;
  onSuccess?: () => void;
  /** "row" = compact, fits a table cell. "block" = stacked, for a page header/side panel. */
  variant?: "row" | "block";
  className?: string;
}

/**
 * "Enviar al diseñador" + designer picker — drives
 * indigo.order.action_send_to_designer via /api/orders/[id]/send-to-designer.
 *
 * Renders the Ficha de orden, attaches it to the order, emails the
 * designer, and advances the order to CNC. Per Majela's 2026-08-15
 * request (docs/majela/audio-1-digitalizacion.md), this is the ONE thing
 * that both produces the PDF for the designer and moves the order out of
 * Digitalization — so the stage itself tells her what's done.
 */
export function SendToDesignerControl({
  orderId,
  currentDesignerId,
  onSuccess,
  variant = "row",
  className,
}: SendToDesignerControlProps) {
  const [designerId, setDesignerId] = useState<number | "">(
    currentDesignerId ? currentDesignerId[0] : "",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDesignerId(currentDesignerId ? currentDesignerId[0] : "");
  }, [currentDesignerId]);

  const { data } = useQuery<{ records: Designer[] }>({
    queryKey: ["designers"],
    queryFn: () => fetch("/api/designers").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });
  const designers = data?.records ?? [];

  async function send() {
    if (!designerId) {
      toast.warning("Pick a designer first");
      return;
    }
    setBusy(true);
    const promise = fetch(`/api/orders/${orderId}/send-to-designer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designer_id: designerId }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        onSuccess?.();
      })
      .finally(() => setBusy(false));

    toast.promise(promise, {
      loading: "Sending to the designer…",
      success: "Order sheet sent — order moved to CNC",
      error: (e) => (e instanceof Error ? e.message : "Could not send"),
    });
  }

  const stacked = variant === "block";

  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        stacked && "flex-col items-stretch gap-2",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <select
        value={designerId}
        onChange={(e) =>
          setDesignerId(e.target.value ? Number(e.target.value) : "")
        }
        disabled={busy}
        className={cn(
          "h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none",
          stacked ? "h-10 w-full text-sm" : "w-32",
        )}
      >
        <option value="">Pick a designer…</option>
        {designers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={send}
        disabled={busy || !designerId}
        title="Builds the order sheet, emails it to the designer and moves the order to CNC"
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-indigo-700 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-40",
          stacked && "h-10 text-sm",
        )}
      >
        <Send size={12} />
        {busy ? "Sending…" : "Send to designer"}
      </button>
    </div>
  );
}
