"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  X,
  Check,
  ChevronDown,
  Info,
  Upload,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Trash2,
} from "lucide-react";
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
import { FractionalInchInput } from "@/components/fractional-inch-input";
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
  // Fall back to the standard catalog palette when the design hasn't
  // had `allowed_colors` populated yet — otherwise the picker would
  // not render and the order would default to "white" silently.
  const effectiveColors = colors.length ? colors : ["white", "bronze", "black"];
  const [color, setColor] = useState<string>(effectiveColors[0]);
  // Width / Height carry decimal inches in state but the input parses
  // US fractional notation ("23 3/4") and snaps to 1/16" on blur.
  const [width, setWidth] = useState<number | "">(36);
  const [height, setHeight] = useState<number | "">(80);
  const [qty, setQty] = useState("1");
  // Customer / Client PO — the purchase-order number the dealer's
  // customer issued. Distinct from `dealer_ref` (internal dealer code)
  // and `priv_ref` (label-only ref). Optional.
  const [customerPo, setCustomerPo] = useState("");
  // Queue of files the operator wants to attach to the order. They're
  // collected before the order exists; we upload them sequentially after
  // /api/orders returns the new id.
  const [files, setFiles] = useState<File[]>([]);
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
    setColor(effectiveColors[0]);
    setWidth(36);
    setHeight(80);
    setQty("1");
    setCustomerPo("");
    setFiles([]);
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
    const w = typeof width === "number" ? width : NaN;
    const h = typeof height === "number" ? height : NaN;
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
      toast.warning("Width and Height must be positive numbers (e.g. 23 3/4).");
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
          customer_po: customerPo.trim() || undefined,
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
      // Upload attachments sequentially so a single failed file doesn't
      // abort the rest. We don't fail the whole flow if attachments error
      // — the order is already saved and the user can retry from the
      // detail page.
      if (files.length) {
        let failed = 0;
        for (const f of files) {
          const fd = new FormData();
          fd.append("file", f);
          try {
            const ur = await fetch(`/api/orders/${j.id}/attachments`, {
              method: "POST",
              body: fd,
            });
            if (!ur.ok) failed++;
          } catch {
            failed++;
          }
        }
        if (failed) {
          toast.warning(
            `Order created, but ${failed} of ${files.length} attachment${files.length === 1 ? "" : "s"} failed to upload. Retry from the order detail.`,
            { duration: 8000 },
          );
        }
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

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    // Cap at 20 MB per file — same limit as the per-order attachment
    // endpoint enforces server-side.
    const accepted: File[] = [];
    let rejected = 0;
    for (const f of incoming) {
      if (f.size > 20 * 1024 * 1024) {
        rejected++;
      } else {
        accepted.push(f);
      }
    }
    if (rejected) {
      toast.warning(`${rejected} file${rejected === 1 ? "" : "s"} skipped — over 20 MB.`);
    }
    setFiles((prev) => [...prev, ...accepted]);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
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
          <section>
            <Label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Color
              {colors.length === 0 && (
                <span className="ml-2 text-[9px] font-normal text-slate-400 normal-case tracking-normal">
                  (default palette — design has no specific colors set)
                </span>
              )}
            </Label>
            <div className="flex flex-wrap gap-2">
              {effectiveColors.map((c) => {
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

          {/* Dimensions — accepts US fractional inches ("23 3/4") and
              decimals. Snaps to 1/16" on blur. */}
          <section className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="no-w">Width</Label>
              <FractionalInchInput
                id="no-w"
                value={width}
                onChange={setWidth}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="no-h">Height</Label>
              <FractionalInchInput
                id="no-h"
                value={height}
                onChange={setHeight}
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

          {/* Customer / Client PO */}
          <section className="space-y-1">
            <Label htmlFor="no-po" className="flex items-center gap-1.5">
              Customer PO / Client PO
              <span
                className="cursor-help text-slate-400"
                title="Purchase order number from the end customer — printed on the invoice and used to reconcile payments."
              >
                <Info size={12} />
              </span>
            </Label>
            <Input
              id="no-po"
              value={customerPo}
              onChange={(e) => setCustomerPo(e.target.value)}
              placeholder="PO-784512"
            />
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

          {/* Attachments — files are queued client-side and uploaded
              after /api/orders returns the new id. */}
          <section className="space-y-2 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-3.5">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                Attachments
              </Label>
              <p className="mt-0.5 text-xs text-slate-500">
                Upload any relevant documents (PO, contract, photos,
                measurements, HOA approval, etc.)
              </p>
            </div>
            <FileDrop onFiles={addFiles} />
            {files.length > 0 && (
              <ul className="space-y-1.5">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  >
                    {/^image\//.test(f.type) ? (
                      <ImageIcon size={14} className="text-emerald-600" />
                    ) : (
                      <FileText size={14} className="text-rose-600" />
                    )}
                    <span className="flex-1 truncate font-medium text-slate-700">
                      {f.name}
                    </span>
                    <span className="text-[10px] tabular-nums text-slate-400">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-700"
                      aria-label={`Remove ${f.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
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

/**
 * Click-to-pick + drag-and-drop file dropzone. Defers all storage
 * decisions to the parent — just emits `onFiles(list)` and lets the
 * parent stage, validate, and upload.
 */
function FileDrop({ onFiles }: { onFiles: (list: FileList | null) => void }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-center gap-3 rounded-lg border-2 border-dashed bg-white px-3 py-4 text-sm transition",
        dragOver
          ? "border-indigo-400 bg-indigo-50"
          : "border-slate-300 hover:border-indigo-300 hover:bg-indigo-50/40",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFiles(e.dataTransfer?.files ?? null);
      }}
    >
      <Upload size={16} className="text-indigo-600" />
      <span className="text-slate-700">
        Drag and drop files here or{" "}
        <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-xs font-medium text-indigo-700">
          <Paperclip size={11} /> Upload file
        </span>
      </span>
      <input
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
        onChange={(e) => {
          onFiles(e.target.files);
          // Reset so the same file can be re-picked.
          e.target.value = "";
        }}
      />
      <span className="ml-auto text-[10px] text-slate-400">
        PDF, JPG, PNG, DOCX, XLSX (Max 20 MB)
      </span>
    </label>
  );
}
