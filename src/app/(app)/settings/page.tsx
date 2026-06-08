"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Settings,
  Save,
  Plus,
  Trash2,
  Factory,
  Brush,
  Wrench,
  ArrowRight,
  Tag,
  Layers,
  Building2,
  Users,
  AlertTriangle,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/state-cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RateRow {
  id: number;
  name: string;
  contractor_type: "painter" | "installer" | "other";
  rate: number;
  rate_unit: "sqf" | "piece";
  active: boolean;
}

interface Capacities {
  cnc: number;
  painting: number;
  install: number;
}

interface DraftRate {
  id?: number;
  _tempId?: number;
  _delete?: boolean;
  name: string;
  contractor_type: "painter" | "installer" | "other";
  rate: number;
  rate_unit: "sqf" | "piece";
  active: boolean;
}

interface SettingsData {
  capacities: Capacities;
  rates: RateRow[];
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<SettingsData>({
    queryKey: ["settings"],
    queryFn: async () => {
      const r = await fetch("/api/settings");
      if (!r.ok) throw new Error("Failed to load settings");
      return r.json();
    },
  });

  const [caps, setCaps] = useState<Capacities>({ cnc: 8, painting: 200, install: 5 });
  const [rates, setRates] = useState<DraftRate[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setCaps(data.capacities);
      setRates(data.rates.map((r) => ({ ...r })));
      setDirty(false);
    }
  }, [data]);

  function updateRate(idx: number, patch: Partial<DraftRate>) {
    setRates((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
    setDirty(true);
  }

  function addRate(type: "painter" | "installer" | "other") {
    setRates((prev) => [
      ...prev,
      {
        _tempId: Math.max(0, ...prev.map((r) => r._tempId ?? 0)) + 1,
        name: type === "painter" ? "New painter" : type === "installer" ? "New installer" : "New rate",
        contractor_type: type,
        rate: type === "painter" ? 8 : type === "installer" ? 35 : 0,
        rate_unit: type === "painter" ? "sqf" : "piece",
        active: true,
      },
    ]);
    setDirty(true);
  }

  function deleteRate(idx: number) {
    const r = rates[idx];
    if (!r.id) {
      // newly added, just drop from UI
      setRates((prev) => prev.filter((_, i) => i !== idx));
    } else {
      updateRate(idx, { _delete: true });
    }
  }

  async function save() {
    setSaving(true);
    const payload = {
      capacities: caps,
      rates: rates.map((r) => ({
        id: r.id,
        _delete: r._delete,
        name: r.name,
        contractor_type: r.contractor_type,
        rate: Number(r.rate) || 0,
        rate_unit: r.rate_unit,
        active: r.active,
      })),
    };
    const promise = fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        qc.setQueryData(["settings"], { capacities: j.capacities, rates: j.rates });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        setDirty(false);
        return j;
      })
      .finally(() => setSaving(false));

    toast.promise(promise, {
      loading: "Saving...",
      success: "Settings saved",
      error: (e) => (e instanceof Error ? e.message : "Failed to save"),
    });
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load settings"
        message={error instanceof Error ? error.message : "Unknown error"}
        onRetry={() => refetch()}
      />
    );
  }

  const visibleRates = rates.map((r, i) => ({ r, i })).filter(({ r }) => !r._delete);
  const painters = visibleRates.filter(({ r }) => r.contractor_type === "painter");
  const installers = visibleRates.filter(({ r }) => r.contractor_type === "installer");
  const others = visibleRates.filter(({ r }) => r.contractor_type === "other");

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-slate-500 text-xs uppercase tracking-wider font-semibold">
            <Settings size={14} />
            Configuration
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Settings
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Production capacities, contractor rates and admin shortcuts.
          </p>
        </div>
        <Button
          type="button"
          size="lg"
          onClick={save}
          disabled={!dirty || saving || isLoading}
        >
          <Save size={14} />
          {saving ? "Saving..." : dirty ? "Save changes" : "Saved"}
        </Button>
      </header>

      {/* ---------- Capacities ---------- */}
      <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Production capacity per day</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              These values drive the Dashboard capacity bars. Set realistic daily throughput
              of CNC orders, painting SQF and installations.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <CapacityInput
            label="CNC capacity"
            icon={Factory}
            color="text-indigo-700"
            value={caps.cnc}
            unit="orders/day"
            onChange={(v) => { setCaps((c) => ({ ...c, cnc: v })); setDirty(true); }}
          />
          <CapacityInput
            label="Painting capacity"
            icon={Brush}
            color="text-orange-600"
            value={caps.painting}
            unit="SQF/day"
            onChange={(v) => { setCaps((c) => ({ ...c, painting: v })); setDirty(true); }}
          />
          <CapacityInput
            label="Installation capacity"
            icon={Wrench}
            color="text-emerald-600"
            value={caps.install}
            unit="orders/day"
            onChange={(v) => { setCaps((c) => ({ ...c, install: v })); setDirty(true); }}
          />
        </div>
      </section>

      {/* ---------- Contractor rates ---------- */}
      <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Contractor rates</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Each rate drives the Hoja del Pintor totals and weekly installer settlement.
            </p>
          </div>
        </div>

        <RateGroup
          title="Painters"
          icon={Brush}
          color="text-orange-600"
          rates={painters}
          onUpdate={updateRate}
          onDelete={deleteRate}
          onAdd={() => addRate("painter")}
        />
        <RateGroup
          title="Installers"
          icon={Wrench}
          color="text-emerald-600"
          rates={installers}
          onUpdate={updateRate}
          onDelete={deleteRate}
          onAdd={() => addRate("installer")}
        />
        {(others.length > 0) && (
          <RateGroup
            title="Other"
            icon={Tag}
            color="text-slate-600"
            rates={others}
            onUpdate={updateRate}
            onDelete={deleteRate}
            onAdd={() => addRate("other")}
          />
        )}
        {others.length === 0 && (
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => addRate("other")}
              className="text-slate-500 hover:text-slate-700"
            >
              + Other contractor type
            </Button>
          </div>
        )}
      </section>

      {/* ---------- Orphan assignments ---------- */}
      <OrphanAssignmentCard />

      {/* ---------- Admin shortcuts ---------- */}
      <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Admin shortcuts</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <ShortcutCard
            icon={Building2}
            title="Dealers & Catalog"
            description="Dealers, brands, door designs and codes."
            href="/catalog"
          />
          <ShortcutCard
            icon={Layers}
            title="Orders"
            description="Filter, search and inspect every active order."
            href="/orders"
          />
        </div>
      </section>
    </div>
  );
}

interface OrphansPayload {
  orphanPainters: Array<{ id: number; name: string }>;
  orphanInstallers: Array<{ id: number; name: string }>;
  defaults: {
    painter: { id: number; name: string } | null;
    installer: { id: number; name: string } | null;
  };
}

function OrphanAssignmentCard() {
  const qc = useQueryClient();
  const { data, refetch, isLoading } = useQuery<OrphansPayload>({
    queryKey: ["orphans"],
    queryFn: () => fetch("/api/orders/auto-assign").then((r) => r.json()),
    staleTime: 30_000,
  });

  const totalOrphans =
    (data?.orphanPainters.length ?? 0) + (data?.orphanInstallers.length ?? 0);

  async function fix() {
    const promise = fetch("/api/orders/auto-assign", { method: "POST" }).then(
      async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        await refetch();
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        qc.invalidateQueries({ queryKey: ["billing-summary"] });
        return j;
      },
    );
    toast.promise(promise, {
      loading: "Auto-assigning…",
      success: (j) =>
        `Updated ${j.painterUpdates} painter / ${j.installerUpdates} installer assignments`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-amber-600" />
          <h2 className="text-base font-semibold text-slate-900">
            Orphan contractor assignments
          </h2>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={fix}
          disabled={isLoading || totalOrphans === 0}
        >
          <Wand2 size={14} />
          Auto-assign defaults
        </Button>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Orders past CNC need a painter assigned, and orders past Ready for
        Installation need at least one installer — otherwise the Odoo stage
        trigger generates no payout. This panel fills the gap with the
        first active contractor of each type.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-orange-700">
            <Brush size={14} />
            Painter
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {data?.orphanPainters.length ?? "…"}
            </span>
            <span className="text-xs text-slate-500">orphan orders</span>
          </div>
          {data?.defaults.painter ? (
            <p className="mt-2 text-[11px] text-slate-500">
              Default: <strong>{data.defaults.painter.name}</strong>
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-rose-700">
              <AlertTriangle size={10} className="inline" /> No active painter
              configured.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
            <Wrench size={14} />
            Installer
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {data?.orphanInstallers.length ?? "…"}
            </span>
            <span className="text-xs text-slate-500">orphan orders</span>
          </div>
          {data?.defaults.installer ? (
            <p className="mt-2 text-[11px] text-slate-500">
              Default: <strong>{data.defaults.installer.name}</strong>
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-rose-700">
              <AlertTriangle size={10} className="inline" /> No active installer
              configured.
            </p>
          )}
        </div>
      </div>

      {totalOrphans === 0 && !isLoading && (
        <p className="mt-3 text-center text-xs text-emerald-700">
          ✓ All orders past CNC have contractor assignments.
        </p>
      )}
    </section>
  );
}

function CapacityInput({
  label,
  icon: Icon,
  color,
  value,
  unit,
  onChange,
}: {
  label: string;
  icon: typeof Settings;
  color: string;
  value: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
      <Label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <Icon size={14} className={color} />
        {label}
      </Label>
      <div className="mt-3 flex items-baseline gap-2">
        <Input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 text-2xl font-bold text-slate-900"
        />
        <span className="text-xs text-slate-500">{unit}</span>
      </div>
    </div>
  );
}

function RateGroup({
  title,
  icon: Icon,
  color,
  rates,
  onUpdate,
  onDelete,
  onAdd,
}: {
  title: string;
  icon: typeof Settings;
  color: string;
  rates: Array<{ r: DraftRate; i: number }>;
  onUpdate: (idx: number, patch: Partial<DraftRate>) => void;
  onDelete: (idx: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="mt-6 first:mt-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Icon size={16} className={color} />
          {title}
        </h3>
        <Button type="button" variant="outline" size="xs" onClick={onAdd}>
          <Plus size={12} />
          Add
        </Button>
      </div>
      {rates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/30 px-3 py-4 text-center text-xs text-slate-400">
          No {title.toLowerCase()} configured yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {rates.map(({ r, i }) => (
            <li
              key={r.id ?? `tmp-${r._tempId}`}
              className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 ${!r.active ? "opacity-50" : ""}`}
            >
              <Input
                value={r.name}
                onChange={(e) => onUpdate(i, { name: e.target.value })}
                placeholder="Name"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm font-medium text-slate-800 shadow-none focus-visible:ring-0"
              />
              <span className="text-slate-400">·</span>
              <span className="text-xs text-slate-500">$</span>
              <Input
                type="number"
                value={r.rate}
                step={0.5}
                onChange={(e) => onUpdate(i, { rate: Number(e.target.value) })}
                className="w-20 tabular-nums"
              />
              <span className="text-xs text-slate-500">per</span>
              <Select
                value={r.rate_unit}
                onValueChange={(v) => onUpdate(i, { rate_unit: v as "sqf" | "piece" })}
              >
                <SelectTrigger className="h-8 w-auto text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sqf">SQF</SelectItem>
                  <SelectItem value="piece">piece</SelectItem>
                </SelectContent>
              </Select>
              <label className="ml-2 flex items-center gap-1.5 text-xs text-slate-500">
                <Checkbox
                  checked={r.active}
                  onCheckedChange={(v) => onUpdate(i, { active: !!v })}
                />
                Active
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onDelete(i)}
                aria-label="Delete"
                className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ShortcutCard({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: typeof Settings;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-indigo-300 hover:bg-indigo-50/30"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="truncate text-xs text-slate-500">{description}</div>
      </div>
      <ArrowRight size={14} className="text-slate-400 group-hover:text-indigo-600" />
    </Link>
  );
}
