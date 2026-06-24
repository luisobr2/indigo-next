"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, X, Save, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FractionalInchInput } from "@/components/fractional-inch-input";
import { PhoneField } from "@/components/phone-field";
import { cn } from "@/lib/utils";
import { validateOrderEdit, validateLineEdit } from "@/lib/validation";

interface LineRow {
  id: number;
  design_id: [number, string] | false;
  door_type: string;
  color: string;
  glass_type: string;
  glass_privacy: string;
  brand_id?: [number, string] | false;
  width: number;
  height: number;
  width_label: string;
  height_label: string;
  qty: number;
  parts_count?: number;
  design_tier?: string;
  custom_price?: number;
  material?: string;
  thickness?: string;
}

interface OrderRow {
  id: number;
  client_name: string;
  client_phone: string;
  client_email: string;
  client_address: string;
  dealer_ref: string;
  priv_ref: string;
  customer_po: string;
}

interface DesignRow {
  id: number;
  code: string;
  name: string | false;
}

interface Props {
  order: OrderRow;
  lines: LineRow[];
  /** Render trigger inside the parent (header) and show the panel below. */
  trigger?: "header" | "inline";
  /** When `editing` is controlled externally we use it instead of internal state. */
  editing?: boolean;
  onEditingChange?: (v: boolean) => void;
}

const DOOR_TYPES = [
  { value: "SD", label: "Single Door" },
  { value: "DD", label: "Double Door" },
  // Must match the Odoo selection value ("sidelite"), not "SDL" — writing
  // "SDL" would be rejected by the model and silently fail the save.
  { value: "sidelite", label: "Door with Sidelites" },
];
const COLORS = [
  { value: "white", label: "White" },
  { value: "bronze", label: "Bronze" },
  { value: "bronze_eco", label: "Bronze ECO" },
  { value: "black", label: "Black" },
  { value: "custom", label: "Custom" },
];
const PRIVACY = [
  { value: "clear", label: "Clear" },
  { value: "privacy", label: "Privacy" },
];
const DESIGN_TIERS = [
  { value: "basic", label: "Basic" },
  { value: "full_partial", label: "Full / Partial" },
  { value: "custom", label: "Custom" },
];

export function EditOrderPanel({
  order,
  lines,
  trigger = "header",
  editing: editingProp,
  onEditingChange,
}: Props) {
  const qc = useQueryClient();
  const [internalEditing, setInternalEditing] = useState(false);
  const editing = editingProp ?? internalEditing;
  const setEditing = (v: boolean) => {
    if (editingProp === undefined) setInternalEditing(v);
    onEditingChange?.(v);
  };
  const [saving, setSaving] = useState(false);
  const [orderForm, setOrderForm] = useState<OrderRow>(order);
  const [lineForms, setLineForms] = useState<LineRow[]>(lines);
  // Ids of existing pieces the user removed in this edit session — deleted
  // on save. New (unsaved) pieces carry a negative temp id from this ref.
  const [deletedIds, setDeletedIds] = useState<number[]>([]);
  const tempIdRef = useRef(-1);

  useEffect(() => {
    // Only resync from props when we're NOT in the middle of editing —
    // otherwise a background query refetch would wipe the user's input.
    if (!editing) {
      setOrderForm(order);
      setLineForms(lines);
      setDeletedIds([]);
    }
  }, [order, lines, editing]);

  function addLine() {
    const id = tempIdRef.current;
    tempIdRef.current -= 1;
    setLineForms((prev) => [
      ...prev,
      {
        id,
        design_id: false,
        door_type: "SD",
        color: "white",
        glass_type: "",
        glass_privacy: "clear",
        brand_id: false,
        width: 0,
        height: 0,
        width_label: "",
        height_label: "",
        qty: 1,
        parts_count: 1,
        design_tier: "basic",
      },
    ]);
  }

  function removeLine(idx: number) {
    setLineForms((prev) => {
      const line = prev[idx];
      // Existing line (real id) → queue a delete on save. New line → just drop.
      if (line && line.id > 0) setDeletedIds((d) => [...d, line.id]);
      return prev.filter((_, i) => i !== idx);
    });
  }

  // Lazy-load designs for the "Design Selected" dropdown.
  const { data: designs } = useQuery<{ records: DesignRow[] }>({
    queryKey: ["designs-options"],
    queryFn: () => fetch("/api/catalog/designs?limit=500").then((r) => r.json()),
    enabled: editing,
    staleTime: 5 * 60_000,
  });

  const { data: brands } = useQuery<{ records: Array<{ id: number; name: string }> }>({
    queryKey: ["catalog-brands"],
    queryFn: () => fetch("/api/catalog/brands").then((r) => r.json()),
    enabled: editing,
    staleTime: 5 * 60_000,
  });

  function setLineField<K extends keyof LineRow>(
    idx: number,
    key: K,
    value: LineRow[K],
  ) {
    setLineForms((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  }

  async function save() {
    // Client-side validation (mirrored server-side as defense in depth).
    // Validate the full intended state so we never save an invalid order.
    const orderErr = validateOrderEdit({
      client_name: orderForm.client_name,
      client_email: orderForm.client_email,
    });
    if (orderErr) {
      toast.error(orderErr);
      return;
    }
    for (let i = 0; i < lineForms.length; i++) {
      const lf = lineForms[i];
      const lineVals: Record<string, unknown> = {
        width: lf.width,
        height: lf.height,
        qty: lf.qty,
      };
      if (lf.design_tier === "custom") lineVals.custom_price = lf.custom_price;
      const lineErr = validateLineEdit(lineVals, `Piece ${i + 1}`);
      if (lineErr) {
        toast.error(lineErr);
        return;
      }
      // New pieces also need a design chosen.
      if (lf.id <= 0 && !lf.design_id) {
        toast.error(`Piece ${i + 1}: pick a design.`);
        return;
      }
    }

    setSaving(true);
    // Collect every write into a list of promises so we can run them in
    // parallel and report partial failures clearly. There's no DB-level
    // transaction across these calls, but at least we don't stop after
    // one failure — we save what we can and tell the user what didn't.
    const writes: Array<{ label: string; run: () => Promise<void> }> = [];

    // Diff order top-level fields and PUT only the changed keys.
    const orderDiff: Partial<OrderRow> = {};
    (Object.keys(orderForm) as Array<keyof OrderRow>).forEach((k) => {
      if (orderForm[k] !== order[k]) {
        (orderDiff as Record<string, unknown>)[k] = orderForm[k];
      }
    });
    if (Object.keys(orderDiff).length) {
      writes.push({
        label: "Order header",
        run: async () => {
          const r = await fetch(`/api/orders/${order.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(orderDiff),
          });
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error || "failed");
        },
      });
    }

    // New pieces → create; existing pieces → diff & patch.
    for (let i = 0; i < lineForms.length; i++) {
      const lf = lineForms[i];
      const designId = Array.isArray(lf.design_id) ? lf.design_id[0] : undefined;
      const brandId = Array.isArray(lf.brand_id) ? lf.brand_id[0] : false;

      if (lf.id <= 0) {
        const payload: Record<string, unknown> = {
          design_id: designId,
          door_type: lf.door_type,
          color: lf.color,
          glass_type: lf.glass_type,
          glass_privacy: lf.glass_privacy,
          brand_id: brandId || undefined,
          width: lf.width,
          height: lf.height,
          qty: lf.qty,
          parts_count: lf.parts_count ?? 1,
          design_tier: lf.design_tier ?? "basic",
        };
        if (lf.design_tier === "custom") payload.custom_price = lf.custom_price;
        writes.push({
          label: `New piece ${i + 1}`,
          run: async () => {
            const r = await fetch(`/api/orders/${order.id}/lines`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const j = await r.json();
            if (!r.ok || !j.id) throw new Error(j.error || "failed");
          },
        });
        continue;
      }

      const original = lines.find((l) => l.id === lf.id);
      if (!original) continue;
      const lineDiff: Record<string, unknown> = {};
      (Object.keys(lf) as Array<keyof LineRow>).forEach((k) => {
        if (k === "id" || k === "design_id" || k === "brand_id") return;
        if (lf[k] !== original[k]) lineDiff[k as string] = lf[k];
      });
      if (
        designId &&
        (!Array.isArray(original.design_id) || designId !== original.design_id[0])
      ) {
        lineDiff.design_id = designId;
      }
      // brand_id is a m2o ([id,name]|false) — diff by id; send false to clear.
      const origBrandId = Array.isArray(original.brand_id) ? original.brand_id[0] : false;
      if (brandId !== origBrandId) {
        lineDiff.brand_id = brandId || false;
      }
      if (Object.keys(lineDiff).length) {
        writes.push({
          label: `Piece ${i + 1}`,
          run: async () => {
            const r = await fetch(`/api/orders/${order.id}/lines/${lf.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(lineDiff),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || "failed");
          },
        });
      }
    }

    // Removed pieces → delete.
    for (const delId of deletedIds) {
      writes.push({
        label: "Removed piece",
        run: async () => {
          const r = await fetch(`/api/orders/${order.id}/lines/${delId}`, {
            method: "DELETE",
          });
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error || "failed");
        },
      });
    }

    if (!writes.length) {
      setSaving(false);
      toast.info("Nothing to save");
      setEditing(false);
      return;
    }

    const results = await Promise.allSettled(writes.map((w) => w.run()));
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["order", String(order.id)] });
    qc.invalidateQueries({ queryKey: ["order-timeline", order.id] });
    qc.invalidateQueries({ queryKey: ["order-activity", order.id] });

    const failures = results
      .map((r, i) => ({ r, label: writes[i].label }))
      .filter((x) => x.r.status === "rejected");
    if (failures.length === 0) {
      toast.success("Order updated");
      setEditing(false);
      return;
    }
    if (failures.length === writes.length) {
      toast.error(
        `All updates failed (${failures.map((f) => f.label).join(", ")}). Try again.`,
      );
      return; // keep editing on so the user doesn't lose their input
    }
    toast.warning(
      `Saved partial: ${failures.length} of ${writes.length} updates failed (${failures.map((f) => f.label).join(", ")}).`,
      { duration: 8000 },
    );
  }

  // Trigger button (rendered in parent header).
  if (trigger === "header") {
    return (
      <Button
        onClick={() => setEditing(!editing)}
        variant={editing ? "outline" : "secondary"}
        size="lg"
      >
        {editing ? (
          <>
            <X size={14} /> Cancel edit
          </>
        ) : (
          <>
            <Pencil size={14} /> Edit order
          </>
        )}
      </Button>
    );
  }

  // Inline panel — rendered when editing is on.
  if (!editing) return null;

  return (
    <div className="space-y-4 rounded-2xl border-2 border-indigo-200 bg-indigo-50/30 p-5 shadow-sm">
      <header className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-indigo-900">
          <Pencil size={16} />
          Editing order
        </h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setOrderForm(order);
              setLineForms(lines);
              setEditing(false);
            }}
            disabled={saving}
          >
            <X size={14} /> Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700"
          >
            {saving ? "Saving…" : (<><Save size={14} /> Save changes</>)}
          </Button>
        </div>
      </header>

      {/* Customer */}
      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-100">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
          Customer information
        </h4>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Name">
            <Input
              value={orderForm.client_name || ""}
              onChange={(e) =>
                setOrderForm({ ...orderForm, client_name: e.target.value })
              }
            />
          </Field>
          <Field label="Phone">
            <PhoneField
              value={orderForm.client_phone || ""}
              onChange={(v) =>
                setOrderForm({ ...orderForm, client_phone: v })
              }
            />
          </Field>
          <Field label="Email">
            <Input
              value={orderForm.client_email || ""}
              onChange={(e) =>
                setOrderForm({ ...orderForm, client_email: e.target.value })
              }
            />
          </Field>
          <Field label="Dealer reference">
            <Input
              value={orderForm.dealer_ref || ""}
              onChange={(e) =>
                setOrderForm({ ...orderForm, dealer_ref: e.target.value })
              }
            />
          </Field>
          <Field label="Customer PO">
            <Input
              value={orderForm.customer_po || ""}
              placeholder="PO-784512"
              onChange={(e) =>
                setOrderForm({ ...orderForm, customer_po: e.target.value })
              }
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Address">
              <Textarea
                rows={2}
                value={orderForm.client_address || ""}
                onChange={(e) =>
                  setOrderForm({ ...orderForm, client_address: e.target.value })
                }
              />
            </Field>
          </div>
        </div>
      </section>

      {/* Lines */}
      {lineForms.map((line, idx) => (
        <section
          key={line.id}
          className="rounded-xl bg-white p-4 ring-1 ring-slate-100"
        >
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Piece {idx + 1}
              {line.id <= 0 && (
                <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                  NEW
                </span>
              )}
            </h4>
            {/* Don't allow removing the last piece — an order needs ≥ 1. */}
            <button
              type="button"
              onClick={() => removeLine(idx)}
              disabled={lineForms.length <= 1}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
              title={
                lineForms.length <= 1
                  ? "An order must keep at least one piece"
                  : "Remove this piece"
              }
            >
              <Trash2 size={12} /> Remove
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Design">
              <select
                value={
                  Array.isArray(line.design_id) ? String(line.design_id[0]) : ""
                }
                onChange={(e) => {
                  const id = Number(e.target.value);
                  const found = designs?.records.find((d) => d.id === id);
                  if (!found) return;
                  setLineField(idx, "design_id", [
                    found.id,
                    (found.name as string) || found.code,
                  ] as [number, string]);
                }}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none"
              >
                {Array.isArray(line.design_id) ? (
                  <option value={String(line.design_id[0])}>
                    {line.design_id[1]}
                  </option>
                ) : (
                  <option value="">— Select design —</option>
                )}
                {designs?.records
                  ?.filter(
                    (d) =>
                      !Array.isArray(line.design_id) || d.id !== line.design_id[0],
                  )
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name || d.code}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Door type">
              <SelectInput
                value={line.door_type}
                onChange={(v) => setLineField(idx, "door_type", v)}
                options={DOOR_TYPES}
              />
            </Field>
            <Field label="Color">
              <SelectInput
                value={line.color}
                onChange={(v) => setLineField(idx, "color", v)}
                options={COLORS}
              />
            </Field>
            <Field label="Width">
              <FractionalInchInput
                value={line.width || ""}
                onChange={(v) =>
                  setLineField(idx, "width", v === "" ? 0 : v)
                }
                showHint={false}
              />
            </Field>
            <Field label="Height">
              <FractionalInchInput
                value={line.height || ""}
                onChange={(v) =>
                  setLineField(idx, "height", v === "" ? 0 : v)
                }
                showHint={false}
              />
            </Field>
            <Field label="Quantity">
              <Input
                type="number"
                min="1"
                value={line.qty === 0 || line.qty ? String(line.qty) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setLineField(idx, "qty", v === "" ? 1 : parseInt(v));
                }}
              />
            </Field>
            <Field label="Pieces">
              <Input
                type="number"
                min="1"
                value={line.parts_count ? String(line.parts_count) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setLineField(idx, "parts_count", v === "" ? 1 : parseInt(v));
                }}
              />
            </Field>
            {/* Glass type hidden — not managed by the office. */}
            <Field label="Privacy">
              <SelectInput
                value={line.glass_privacy}
                onChange={(v) => setLineField(idx, "glass_privacy", v)}
                options={PRIVACY}
              />
            </Field>
            <Field label="Brand">
              <select
                value={Array.isArray(line.brand_id) ? String(line.brand_id[0]) : ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (!id) {
                    setLineField(idx, "brand_id", false);
                    return;
                  }
                  const found = brands?.records.find((b) => b.id === id);
                  setLineField(idx, "brand_id", [id, found?.name ?? ""] as [number, string]);
                }}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none"
              >
                <option value="">— None —</option>
                {brands?.records?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Price tier">
              <SelectInput
                value={line.design_tier ?? "basic"}
                onChange={(v) => setLineField(idx, "design_tier", v)}
                options={DESIGN_TIERS}
              />
            </Field>
            {line.design_tier === "custom" && (
              <Field label="Custom price (USD)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    line.custom_price === 0 || line.custom_price
                      ? String(line.custom_price)
                      : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    setLineField(idx, "custom_price", v === "" ? 0 : parseFloat(v));
                  }}
                />
              </Field>
            )}
            <div />
          </div>
        </section>
      ))}

      {/* Add another door/piece to this order. */}
      <button
        type="button"
        onClick={addLine}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-indigo-200 bg-white py-3 text-sm font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50/50"
      >
        <Plus size={16} /> Add piece
      </button>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </Label>
      {children}
    </div>
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none",
      )}
    >
      <option value=""></option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
