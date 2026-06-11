"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, X, Save, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FractionalInchInput } from "@/components/fractional-inch-input";
import { cn } from "@/lib/utils";

interface LineRow {
  id: number;
  design_id: [number, string] | false;
  door_type: string;
  color: string;
  glass_type: string;
  glass_privacy: string;
  width: number;
  height: number;
  width_label: string;
  height_label: string;
  qty: number;
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
  { value: "SDL", label: "Door with Sidelites" },
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

  useEffect(() => {
    // Only resync from props when we're NOT in the middle of editing —
    // otherwise a background query refetch would wipe the user's input.
    if (!editing) {
      setOrderForm(order);
      setLineForms(lines);
    }
  }, [order, lines, editing]);

  // Lazy-load designs for the "Design Selected" dropdown.
  const { data: designs } = useQuery<{ records: DesignRow[] }>({
    queryKey: ["designs-options"],
    queryFn: () => fetch("/api/catalog/designs?limit=500").then((r) => r.json()),
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

    // Diff each line.
    for (let i = 0; i < lineForms.length; i++) {
      const lf = lineForms[i];
      const original = lines[i];
      if (!original) continue;
      const lineDiff: Record<string, unknown> = {};
      (Object.keys(lf) as Array<keyof LineRow>).forEach((k) => {
        if (k === "id" || k === "design_id") return;
        if (lf[k] !== original[k]) lineDiff[k as string] = lf[k];
      });
      if (lf.design_id && original.design_id) {
        const cur =
          Array.isArray(lf.design_id) && Array.isArray(original.design_id)
            ? lf.design_id[0] !== original.design_id[0]
            : false;
        if (cur) {
          lineDiff.design_id = Array.isArray(lf.design_id) ? lf.design_id[0] : lf.design_id;
        }
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
              value={orderForm.client_name ?? ""}
              onChange={(e) =>
                setOrderForm({ ...orderForm, client_name: e.target.value })
              }
            />
          </Field>
          <Field label="Phone">
            <Input
              value={orderForm.client_phone ?? ""}
              onChange={(e) =>
                setOrderForm({ ...orderForm, client_phone: e.target.value })
              }
            />
          </Field>
          <Field label="Email">
            <Input
              value={orderForm.client_email ?? ""}
              onChange={(e) =>
                setOrderForm({ ...orderForm, client_email: e.target.value })
              }
            />
          </Field>
          <Field label="Dealer reference">
            <Input
              value={orderForm.dealer_ref ?? ""}
              onChange={(e) =>
                setOrderForm({ ...orderForm, dealer_ref: e.target.value })
              }
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Address">
              <Textarea
                rows={2}
                value={orderForm.client_address ?? ""}
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
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            Piece {idx + 1}
          </h4>
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
                {Array.isArray(line.design_id) && (
                  <option value={String(line.design_id[0])}>
                    {line.design_id[1]}
                  </option>
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
            <Field label="Glass type">
              <Input
                value={line.glass_type ?? ""}
                onChange={(e) => setLineField(idx, "glass_type", e.target.value)}
              />
            </Field>
            <Field label="Privacy">
              <SelectInput
                value={line.glass_privacy}
                onChange={(v) => setLineField(idx, "glass_privacy", v)}
                options={PRIVACY}
              />
            </Field>
            <div />
          </div>
        </section>
      ))}
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
