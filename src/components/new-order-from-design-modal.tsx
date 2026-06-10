"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Sparkles, X, Check, ChevronDown } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface FamilyVariant {
  id: number;
  code: string;
  door_type: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  family: string;
  variants: FamilyVariant[];
  /** Lower-cased allowed colour codes (white, bronze, ...). */
  colors: string[];
}

interface Dealer {
  id: number;
  name: string;
}

const COLOR_LABEL: Record<string, { label: string; dot: string }> = {
  white: { label: "White", dot: "#fff" },
  bronze: { label: "Bronze", dot: "#a16207" },
  bronze_eco: { label: "Bronze ECO", dot: "#854d0e" },
  black: { label: "Black", dot: "#111" },
  custom: { label: "Custom", dot: "#a78bfa" },
};

const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "Single Door",
  DD: "Double Door",
  sidelite: "Door with Sidelites",
};

export function NewOrderFromDesignModal({
  open,
  onClose,
  family,
  variants,
  colors,
}: Props) {
  const router = useRouter();
  const qc = useQueryClient();

  // Form state — kept minimal so a manager can capture an order in
  // seconds from the catalog browse view. Anything beyond the basics
  // (note, dealer ref, expected dates) goes through Edit Order on the
  // detail page once the row exists.
  const [dealerId, setDealerId] = useState<number | "">("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [variantId, setVariantId] = useState<number>(variants[0]?.id ?? 0);
  const [color, setColor] = useState<string>(colors[0] ?? "white");
  const [width, setWidth] = useState("36");
  const [height, setHeight] = useState("80");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);

  const dealersQ = useQuery<{ records: Dealer[] }>({
    queryKey: ["catalog-dealers"],
    queryFn: () => fetch("/api/catalog/dealers").then((r) => r.json()),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  function reset() {
    setDealerId("");
    setClientName("");
    setClientPhone("");
    setClientEmail("");
    setClientAddress("");
    setVariantId(variants[0]?.id ?? 0);
    setColor(colors[0] ?? "white");
    setWidth("36");
    setHeight("80");
    setQty("1");
    setBusy(false);
  }

  async function submit() {
    if (!dealerId) {
      toast.warning("Pick a dealer first.");
      return;
    }
    if (!clientName.trim()) {
      toast.warning("Client name is required.");
      return;
    }
    if (!variantId) {
      toast.warning("Pick a configuration (Single Door / Double Door).");
      return;
    }
    const w = parseFloat(width);
    const h = parseFloat(height);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
      toast.warning("Width and Height must be positive numbers.");
      return;
    }
    const q = parseInt(qty, 10);
    if (!Number.isFinite(q) || q <= 0) {
      toast.warning("Quantity must be a positive integer.");
      return;
    }
    const variant = variants.find((v) => v.id === variantId);
    if (!variant) return;

    setBusy(true);
    try {
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealer_id: dealerId,
          client_name: clientName.trim(),
          client_phone: clientPhone.trim(),
          client_email: clientEmail.trim(),
          client_address: clientAddress.trim(),
          line_ids: [
            [
              0,
              0,
              {
                design_id: variant.id,
                door_type: variant.door_type,
                color,
                width: w,
                height: h,
                qty: q,
              },
            ],
          ],
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.id) {
        throw new Error(j.error || "Create failed");
      }
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Order created — opening detail`);
      reset();
      onClose();
      router.push(`/orders/${j.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-700" />
            New order — {family}
          </DialogTitle>
          <DialogDescription>
            Capture the essentials. You can edit the rest (dealer ref,
            expected date, notes) from the order detail once it&apos;s
            created.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Configuration picker */}
          <section>
            <Label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Configuration
            </Label>
            <div className="flex flex-wrap gap-2">
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVariantId(v.id)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs font-medium transition",
                    variantId === v.id
                      ? "border-indigo-300 bg-indigo-50 text-indigo-800 ring-2 ring-indigo-200"
                      : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200",
                  )}
                >
                  {DOOR_TYPE_LABEL[v.door_type] ?? v.door_type}
                  <span className="ml-1 text-[9px] text-slate-400">{v.code}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Color picker */}
          {colors.length > 0 && (
            <section>
              <Label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Color
              </Label>
              <div className="flex flex-wrap gap-2">
                {colors.map((c) => {
                  const cfg = COLOR_LABEL[c] ?? { label: c, dot: "#cbd5e1" };
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition",
                        color === c
                          ? "border-indigo-300 bg-indigo-50 text-indigo-800 ring-2 ring-indigo-200"
                          : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200",
                      )}
                    >
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-slate-300"
                        style={{ background: cfg.dot }}
                      />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Dimensions */}
          <section className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="no-w">Width (in)</Label>
              <Input
                id="no-w"
                type="number"
                step="0.125"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="no-h">Height (in)</Label>
              <Input
                id="no-h"
                type="number"
                step="0.125"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="no-q">Quantity</Label>
              <Input
                id="no-q"
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
          </section>

          {/* Dealer */}
          <section className="space-y-1">
            <Label htmlFor="no-dealer">Dealer</Label>
            <div className="relative">
              <select
                id="no-dealer"
                value={dealerId}
                onChange={(e) =>
                  setDealerId(e.target.value ? Number(e.target.value) : "")
                }
                className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-8 text-sm focus:border-indigo-400 focus:outline-none"
              >
                <option value="">— Select dealer —</option>
                {dealersQ.data?.records?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400"
              />
            </div>
          </section>

          {/* Client */}
          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="no-client">Client name *</Label>
              <Input
                id="no-client"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. John Smith"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="no-phone">Phone</Label>
              <Input
                id="no-phone"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="no-email">Email</Label>
              <Input
                id="no-email"
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="no-addr">Installation address</Label>
              <Textarea
                id="no-addr"
                rows={2}
                value={clientAddress}
                onChange={(e) => setClientAddress(e.target.value)}
              />
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={busy}
          >
            <X size={14} /> Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !dealerId || !clientName.trim()}
            className="bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
          >
            <Check size={14} />
            {busy ? "Creating…" : "Create order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
