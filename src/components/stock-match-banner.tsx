"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, X, ArrowRight, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmtDate, m2o } from "@/lib/utils";

interface StockMatch {
  id: number;
  name: string;
  stock_label: string;
  stock_at: string | false;
  original_client_name: string;
  dealer_id: [number, string] | false;
  first_line?: {
    design_id: [number, string] | false;
    width?: number;
    height?: number;
  } | null;
}

interface Props {
  orderId: number;
  /**
   * Disable for orders that are already past-CNC, already cancelled, or
   * already on the stock pool themselves.
   */
  disabled?: boolean;
}

export function StockMatchBanner({ orderId, disabled }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ records: StockMatch[] }>({
    queryKey: ["stock-matches", orderId],
    queryFn: () =>
      fetch(`/api/inventory/matches?order_id=${orderId}`).then((r) => r.json()),
    enabled: !disabled,
    staleTime: 60_000,
  });

  const matches = data?.records ?? [];
  if (disabled || matches.length === 0) return null;

  async function assign(stockOrderId: number) {
    const promise = fetch(`/api/orders/${orderId}/assign-from-stock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stockOrderId }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["order", String(orderId)] });
      qc.invalidateQueries({ queryKey: ["stock-matches", orderId] });
      qc.invalidateQueries({ queryKey: ["inventory-available"] });
      qc.invalidateQueries({ queryKey: ["order-activity", orderId] });
      setOpen(false);
      return j;
    });
    toast.promise(promise, {
      loading: "Pulling door from stock…",
      success: "Stock assigned — order jumped to Ready for Installation",
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-indigo-700 text-white shadow shadow-indigo-700/30">
            <Zap size={18} />
          </div>
          <div>
            <h3 className="font-bold text-indigo-900">
              {matches.length} stock match{matches.length === 1 ? "" : "es"} available
            </h3>
            <p className="text-xs text-indigo-800/80">
              A finished door already in the warehouse matches this order&apos;s
              design + dimensions (±0.5″). Assign one and skip CNC + Paint.
            </p>
          </div>
        </div>
        <Button
          onClick={() => setOpen(true)}
          className="bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
        >
          <Package size={14} /> See matches
          <ArrowRight size={14} />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package size={18} className="text-indigo-700" />
              Available Stock matches
            </DialogTitle>
            <DialogDescription>
              Pick one of the matching doors to assign it to this order. The
              stock entry is consumed and the order jumps directly to{" "}
              <strong>Ready for Installation</strong>.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {matches.map((m) => {
              const designId =
                m.first_line?.design_id && Array.isArray(m.first_line.design_id)
                  ? m.first_line.design_id[0]
                  : null;
              const designLabel =
                m.first_line?.design_id && Array.isArray(m.first_line.design_id)
                  ? m.first_line.design_id[1]
                  : "—";
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-indigo-300 hover:bg-indigo-50/40"
                >
                  <div className="h-14 w-14 flex-none overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200">
                    {designId ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={`/api/catalog/designs/${designId}/image`}
                        alt={designLabel}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-slate-300">
                        —
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-bold text-slate-800">
                      {m.stock_label || "(no nickname)"}
                    </div>
                    <div className="font-mono text-xs text-indigo-700">
                      {designLabel}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {m.first_line?.width?.toFixed(1)}″ ×{" "}
                      {m.first_line?.height?.toFixed(1)}″ · in stock since{" "}
                      {fmtDate(m.stock_at as string)} · originally{" "}
                      <strong>{m.original_client_name || "—"}</strong> ({m2o(m.dealer_id)?.name ?? "—"})
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => assign(m.id)}
                    className="bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
                  >
                    Use this one
                    <ArrowRight size={12} />
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              <X size={14} /> Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
