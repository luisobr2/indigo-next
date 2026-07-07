"use client";

import { use, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Save,
  Trash2,
  Camera,
  Image as ImageIcon,
  Boxes,
  Hash,
  Eye,
  EyeOff,
  ExternalLink,
  Plus,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/state-cards";
import { fetchJson } from "@/lib/fetch-json";

interface DesignPayload {
  design: {
    id: number;
    code: string;
    name: string | false;
    description: string | false;
    door_type: string | false;
    active: boolean;
    allowed_colors?: string | false;
    allowed_glass_types?: string | false;
    allowed_brand_ids?: number[];
  };
  usedIn: number;
  imageUrl: string | null;
  product: { id: number; is_published: boolean; website_url: string } | null;
}

interface Brand {
  id: number;
  name: string;
  code?: string | false;
}

const COLOR_OPTIONS = [
  { value: "white", label: "White" },
  { value: "bronze", label: "Bronze" },
  { value: "bronze_eco", label: "Bronze ECO" },
  { value: "black", label: "Black" },
  { value: "custom", label: "Custom" },
] as const;

// One design per selected type, grouped by the code prefix. Suffixes match
// familyOf() in /api/catalog/designs/families (-SD / -DD / -SDL).
const TYPE_OPTIONS = [
  { value: "SD", suffix: "SD", label: "Single Door" },
  { value: "DD", suffix: "DD", label: "Double Door" },
  { value: "sidelite", suffix: "SDL", label: "Door with Sidelites" },
] as const;

const stripFamilySuffix = (code: string) => code.replace(/-(SD|DD|SDL)$/i, "");

/* ============================================================= *
 *  Page entry — create form (new) vs family editor (existing)   *
 * ============================================================= */
export default function DesignEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  if (idStr === "new") return <CreateForm />;
  return <FamilyEditor designId={Number(idStr)} idStr={idStr} />;
}

/* ============================================================= *
 *  CREATE — pick the prefix + which door types to generate      *
 * ============================================================= */
function CreateForm() {
  const router = useRouter();
  const qc = useQueryClient();

  const [code, setCode] = useState("");
  const [types, setTypes] = useState<string[]>(["SD", "DD"]);
  const [description, setDescription] = useState("");
  const [colors, setColors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const prefix = stripFamilySuffix(code);

  function toggleType(v: string) {
    setTypes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }
  function toggleColor(v: string) {
    setColors((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  async function create() {
    if (!prefix) {
      toast.error("Poné un código (ej. ID93).");
      return;
    }
    if (types.length === 0) {
      toast.error("Elegí al menos un tipo de puerta.");
      return;
    }
    setSaving(true);
    const ordered = TYPE_OPTIONS.filter((o) => types.includes(o.value));
    const createdIds: number[] = [];
    const createdCodes: string[] = [];
    const failed: string[] = [];
    for (const t of ordered) {
      const dcode = `${prefix}-${t.suffix}`;
      try {
        const r = await fetch(`/api/catalog/designs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: dcode,
            name: `${prefix} ${t.label}`,
            door_type: t.value,
            description,
            allowed_colors: colors.join(","),
          }),
        });
        const j = await r.json();
        if (r.ok && j.id) {
          createdIds.push(j.id);
          createdCodes.push(dcode);
        } else {
          failed.push(`${dcode}${j.error ? ` — ${j.error}` : ""}`);
        }
      } catch {
        failed.push(`${dcode} — error de red`);
      }
    }
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["catalog-families"] });
    if (createdIds.length) {
      toast.success(`Creado${createdIds.length > 1 ? "s" : ""}: ${createdCodes.join(", ")}.`);
      if (failed.length) toast.warning(`No se pudo crear: ${failed.join("; ")}`);
      router.replace(`/catalog/designs/${createdIds[0]}`);
    } else {
      toast.error(`No se pudo crear ningún diseño: ${failed.join("; ")}`);
    }
  }

  return (
    <div className="mx-auto max-w-[820px] space-y-5">
      <Breadcrumb label="New design" />
      <header className="flex items-center gap-3">
        <Link href="/catalog" className="rounded-xl p-1.5 hover:bg-slate-100">
          <ArrowLeft size={18} className="text-slate-500" />
        </Link>
        <Boxes size={26} className="text-indigo-700" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Nuevo diseño</h1>
      </header>

      <section className="space-y-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="code">
              <Hash size={12} className="inline" /> Código
            </Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. ID93"
              className="h-10 font-mono uppercase"
            />
            <p className="text-[11px] text-slate-400">
              Solo el prefijo — el tipo se agrega solo (ID93 → ID93-SD, ID93-DD).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Tipos de puerta</Label>
            <div className="flex flex-wrap gap-2">
              {TYPE_OPTIONS.map((t) => {
                const on = types.includes(t.value);
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => toggleType(t.value)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                      on
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span aria-hidden>{on ? "☑" : "☐"}</span>
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400">
              {prefix && types.length
                ? TYPE_OPTIONS.filter((o) => types.includes(o.value))
                    .map((o) => `${prefix}-${o.suffix}`)
                    .join(", ")
                : "Elegí uno o varios."}
            </p>
          </div>
        </div>

        <ColorsField value={colors} onToggle={toggleColor} />

        <div className="space-y-1.5">
          <Label htmlFor="desc">Descripción (opcional)</Label>
          <Textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Algún detalle del modelo…"
          />
        </div>

        <div className="flex justify-end">
          <Button size="lg" onClick={create} disabled={saving || types.length === 0}>
            <Save size={14} />
            {saving ? "Creando…" : `Crear diseño${types.length > 1 ? "s" : ""}`}
          </Button>
        </div>
      </section>
      <p className="text-center text-xs text-slate-400">
        Después de crear, cargás la imagen de cada tipo en la ficha del diseño.
      </p>
    </div>
  );
}

/* ============================================================= *
 *  FAMILY EDITOR — one screen for the whole design (all types)  *
 * ============================================================= */
function FamilyEditor({ designId, idStr }: { designId: number; idStr: string }) {
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery<DesignPayload>({
    queryKey: ["design", idStr],
    queryFn: () => fetchJson<DesignPayload>(`/api/catalog/designs/${designId}`),
    retry: 1,
  });

  const family = data ? stripFamilySuffix(data.design.code) : "";

  // Siblings in the same family (id + code + door_type). Drives the type row.
  const familyQ = useQuery<{
    records: Array<{ id: number; code: string; door_type: string | false }>;
  }>({
    queryKey: ["design-family", family],
    queryFn: () =>
      fetchJson<{
        records: Array<{ id: number; code: string; door_type: string | false }>;
      }>(`/api/catalog/designs?q=${encodeURIComponent(family)}&limit=100&all=1`),
    enabled: !!family,
    staleTime: 30_000,
  });

  const siblings = (familyQ.data?.records ?? []).filter(
    (r) => stripFamilySuffix(r.code) === family,
  );
  const idByType = new Map<string, number>();
  for (const s of siblings) {
    const t = (s.door_type as string) || "";
    if (t && !idByType.has(t)) idByType.set(t, s.id);
  }

  if (error) {
    const status = (error as (Error & { status?: number }) | null)?.status;
    const notFound = status === 404;
    return (
      <ErrorState
        title={notFound ? "Diseño no encontrado" : "No se pudo cargar el diseño"}
        message={
          notFound
            ? `El diseño #${idStr} no existe o fue removido.`
            : "Algo salió mal. Revisá la conexión y reintentá."
        }
        backHref="/catalog"
        onRetry={notFound ? undefined : () => refetch()}
      />
    );
  }
  if (isLoading || !data) {
    return <div className="p-12 text-center text-slate-400">Cargando…</div>;
  }

  // Flexible / CUSTOM design (no fixed type): the door type is chosen per
  // order, so there's no SD/DD/sidelite split — edit it as a single entry.
  if (!data.design.door_type) {
    return (
      <div className="mx-auto max-w-[820px] space-y-5">
        <Breadcrumb label={data.design.code} />
        <header className="flex flex-wrap items-center gap-3">
          <Link href="/catalog" className="rounded-xl p-1.5 hover:bg-slate-100">
            <ArrowLeft size={18} className="text-slate-500" />
          </Link>
          <Boxes size={26} className="text-indigo-700" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Diseño <span className="font-mono">{data.design.code}</span>
          </h1>
          <Badge variant="secondary" className="bg-indigo-50 text-[10px] text-indigo-700">
            Flexible · el tipo se elige al pedir
          </Badge>
        </header>
        <CommonInfoCard
          family={data.design.code}
          siblingIds={[designId]}
          initial={data.design}
          onSaved={() => qc.invalidateQueries({ queryKey: ["design", idStr] })}
        />
        <div className="max-w-md">
          <TypePanel designId={designId} label="Imágenes del diseño" highlight />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <Breadcrumb label={family || data.design.code} />

      <header className="flex flex-wrap items-center gap-3">
        <Link href="/catalog" className="rounded-xl p-1.5 hover:bg-slate-100">
          <ArrowLeft size={18} className="text-slate-500" />
        </Link>
        <Boxes size={26} className="text-indigo-700" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Diseño <span className="font-mono">{family}</span>
        </h1>
      </header>

      {/* -------- Common info (applies to every type) -------- */}
      <CommonInfoCard
        family={family}
        siblingIds={siblings.map((s) => s.id)}
        initial={data.design}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["design", idStr] });
          for (const s of siblings)
            qc.invalidateQueries({ queryKey: ["design", String(s.id)] });
        }}
      />

      {/* -------- One panel per door type (images live here) -------- */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {TYPE_OPTIONS.map((t) => {
          const existingId = idByType.get(t.value);
          return existingId ? (
            <TypePanel
              key={t.value}
              designId={existingId}
              label={t.label}
              highlight={existingId === designId}
              onChanged={() => familyQ.refetch()}
            />
          ) : (
            <AddTypeCard
              key={t.value}
              label={t.label}
              family={family}
              suffix={t.suffix}
              typeValue={t.value}
              common={{
                description:
                  typeof data.design.description === "string" ? data.design.description : "",
                allowed_colors:
                  typeof data.design.allowed_colors === "string"
                    ? data.design.allowed_colors
                    : "",
                allowed_glass_types:
                  typeof data.design.allowed_glass_types === "string"
                    ? data.design.allowed_glass_types
                    : "",
                allowed_brand_ids: Array.isArray(data.design.allowed_brand_ids)
                  ? data.design.allowed_brand_ids
                  : [],
              }}
              onAdded={() => familyQ.refetch()}
            />
          );
        })}
      </div>
    </div>
  );
}

/* -------- Common info card: writes to every sibling on save -------- */
function CommonInfoCard({
  family,
  siblingIds,
  initial,
  onSaved,
}: {
  family: string;
  siblingIds: number[];
  initial: DesignPayload["design"];
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(
    typeof initial.description === "string" ? initial.description : "",
  );
  const [colors, setColors] = useState<string[]>(
    typeof initial.allowed_colors === "string"
      ? initial.allowed_colors.split(",").map((c) => c.trim()).filter(Boolean)
      : [],
  );
  const [glass, setGlass] = useState(
    typeof initial.allowed_glass_types === "string" ? initial.allowed_glass_types : "",
  );
  const [brandIds, setBrandIds] = useState<number[]>(
    Array.isArray(initial.allowed_brand_ids) ? initial.allowed_brand_ids : [],
  );
  const [advanced, setAdvanced] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const brandsQ = useQuery<{ records: Brand[] }>({
    queryKey: ["catalog-brands"],
    queryFn: () => fetchJson<{ records: Brand[] }>("/api/catalog/brands"),
    staleTime: 5 * 60_000,
    enabled: advanced,
  });

  function mark<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }
  function toggleColor(v: string) {
    setColors((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
    setDirty(true);
  }
  function toggleBrand(id: number) {
    setBrandIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    setDirty(true);
  }

  async function save() {
    if (!siblingIds.length) return;
    // Only write fields the user actually changed. Never push an untouched
    // (possibly blank) value onto siblings that may differ — an empty
    // allowed_colors means "all colors" in Odoo, so a blind overwrite could
    // silently drop a real ordering restriction on the other door types.
    const initColors =
      typeof initial.allowed_colors === "string"
        ? initial.allowed_colors.split(",").map((c) => c.trim()).filter(Boolean)
        : [];
    const initGlass =
      typeof initial.allowed_glass_types === "string" ? initial.allowed_glass_types : "";
    const initBrands = Array.isArray(initial.allowed_brand_ids)
      ? [...initial.allowed_brand_ids].sort((a, b) => a - b)
      : [];
    const body: Record<string, unknown> = {};
    if (description !== (typeof initial.description === "string" ? initial.description : ""))
      body.description = description;
    if (colors.join(",") !== initColors.join(",")) body.allowed_colors = colors.join(",");
    if (advanced) {
      if (glass !== initGlass) body.allowed_glass_types = glass;
      if (
        JSON.stringify([...brandIds].sort((a, b) => a - b)) !== JSON.stringify(initBrands)
      )
        body.allowed_brand_ids = brandIds;
    }
    if (Object.keys(body).length === 0) {
      setDirty(false);
      toast("Sin cambios para guardar.");
      return;
    }
    setSaving(true);
    const results = await Promise.allSettled(
      siblingIds.map((sid) =>
        fetch(`/api/catalog/designs/${sid}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then(async (r) => {
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
          return j;
        }),
      ),
    );
    setSaving(false);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      toast.success("Info del diseño guardada (aplica a todos los tipos).");
      setDirty(false);
      onSaved();
    } else {
      toast.error(`No se pudo guardar en ${failed} de ${siblingIds.length} tipos.`);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Info del diseño
        </h2>
        <span className="text-[11px] text-slate-400">Aplica a Single, Double y Sidelite</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Código</Label>
          <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-sm text-slate-700">
            {family}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="desc">Descripción</Label>
          <Input
            id="desc"
            value={description}
            onChange={(e) => mark(setDescription)(e.target.value)}
            placeholder="Detalle del modelo…"
            className="h-10"
          />
        </div>
      </div>

      <ColorsField value={colors} onToggle={toggleColor} />

      <div>
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ChevronDown size={13} className={advanced ? "rotate-180 transition" : "transition"} />
          Opcional: vidrios y marcas
        </button>
        {advanced && (
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="glass" className="text-xs">
                Tipos de vidrio
              </Label>
              <Input
                id="glass"
                value={glass}
                onChange={(e) => mark(setGlass)(e.target.value)}
                placeholder="e.g. ESW, CGI"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Marcas compatibles</Label>
              <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/40 p-2">
                {(brandsQ.data?.records ?? []).map((b) => (
                  <label
                    key={b.id}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-white"
                  >
                    <input
                      type="checkbox"
                      checked={brandIds.includes(b.id)}
                      onChange={() => toggleBrand(b.id)}
                    />
                    <span className="truncate">{b.name}</span>
                  </label>
                ))}
                {(brandsQ.data?.records ?? []).length === 0 && (
                  <span className="text-[11px] italic text-slate-400">Cargando…</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={!dirty || saving || !siblingIds.length}>
          <Save size={13} />
          {saving ? "Guardando…" : "Guardar info"}
        </Button>
      </div>
    </section>
  );
}

/* -------- Per-type panel: the images for one door type live here -------- */
function TypePanel({
  designId,
  label,
  highlight,
  onChanged,
}: {
  designId: number;
  label: string;
  highlight: boolean;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const idStr = String(designId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pubBusy, setPubBusy] = useState(false);

  const { data } = useQuery<DesignPayload>({
    queryKey: ["design", idStr],
    queryFn: () => fetchJson<DesignPayload>(`/api/catalog/designs/${designId}`),
    retry: 1,
  });
  const product = data?.product ?? null;
  const usedIn = data?.usedIn ?? 0;
  const archived = !!data && data.design.active === false;

  async function uploadImage(file: File, color: string, makeCover: boolean) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    if (color) fd.append("color", color);
    if (makeCover) fd.append("makeCover", "1");
    const promise = fetch(`/api/catalog/designs/${designId}/image`, { method: "POST", body: fd })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Upload failed");
        qc.invalidateQueries({ queryKey: ["design", idStr] });
        qc.invalidateQueries({ queryKey: ["design-images", designId] });
        return j;
      })
      .finally(() => setUploading(false));
    toast.promise(promise, {
      loading: "Subiendo…",
      success: color ? `Agregada variante ${color}` : "Imagen agregada",
      error: (e) => (e instanceof Error ? e.message : "Falló"),
    });
  }

  function patchImage(attId: number, color: string, makeCover = false) {
    const promise = fetch(`/api/catalog/designs/${designId}/image`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attId, color, makeCover }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["design", idStr] });
      qc.invalidateQueries({ queryKey: ["design-images", designId] });
      return j;
    });
    toast.promise(promise, {
      loading: "Actualizando…",
      success: makeCover ? "Portada actualizada" : "Etiqueta actualizada",
      error: (e) => (e instanceof Error ? e.message : "Falló"),
    });
  }

  function deleteOneImage(attId: number) {
    if (!confirm("¿Borrar esta imagen?")) return;
    const promise = fetch(`/api/catalog/designs/${designId}/image?att=${attId}`, {
      method: "DELETE",
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["design", idStr] });
      qc.invalidateQueries({ queryKey: ["design-images", designId] });
      return j;
    });
    toast.promise(promise, {
      loading: "Quitando…",
      success: "Imagen quitada",
      error: (e) => (e instanceof Error ? e.message : "Falló"),
    });
  }

  async function togglePublish() {
    if (pubBusy) return;
    const next = !(product?.is_published ?? false);
    setPubBusy(true);
    try {
      const r = await fetch(`/api/catalog/designs/${designId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: next }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["design", idStr] });
      toast.success(next ? "Visible en la web" : "Oculto de la web");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falló");
    } finally {
      setPubBusy(false);
    }
  }

  async function afterRemoved() {
    qc.invalidateQueries({ queryKey: ["catalog-families"] });
    if (highlight) router.push("/catalog");
    else onChanged?.();
  }

  async function setActive(active: boolean) {
    const r = await fetch(`/api/catalog/designs/${designId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      toast.error(j.error || "No se pudo actualizar");
      return;
    }
    qc.invalidateQueries({ queryKey: ["design", idStr] });
    qc.invalidateQueries({ queryKey: ["catalog-families"] });
    onChanged?.();
    toast.success(active ? `${label} restaurada` : `${label} oculta del catálogo`);
  }

  async function destroy() {
    if (
      !confirm(
        usedIn > 0
          ? `¿Borrar la versión ${label}? Se usó en ${usedIn} orden(es); si no se puede borrar, te ofrezco ocultarla.`
          : `¿Borrar la versión ${label}?`,
      )
    )
      return;
    try {
      const r = await fetch(`/api/catalog/designs/${designId}`, { method: "DELETE" });
      if (r.status === 409) {
        // In use — can't delete. Offer to archive (hide from catalog) instead.
        if (confirm(`No se puede borrar ${label} porque está en uso. ¿Ocultarla del catálogo?`))
          await setActive(false);
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error || "Failed");
      toast.success(`${label} borrada`);
      await afterRemoved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falló");
    }
  }

  return (
    <section
      className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm ${
        highlight ? "border-indigo-300 ring-1 ring-indigo-100" : "border-slate-100"
      } ${archived ? "opacity-70" : ""}`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800">{label}</h3>
        {archived ? (
          <Badge variant="secondary" className="bg-amber-50 text-[10px] text-amber-700">
            Archivado
          </Badge>
        ) : product?.is_published ? (
          <Badge variant="secondary" className="bg-emerald-50 text-[10px] text-emerald-700">
            En la web
          </Badge>
        ) : (
          <Badge variant="secondary" className="bg-slate-100 text-[10px] text-slate-500">
            Oculto
          </Badge>
        )}
      </div>

      <ImageGallery
        designId={designId}
        onRetag={patchImage}
        onDelete={deleteOneImage}
        uploading={uploading}
      />
      <ImageUploader uploading={uploading} fileInputRef={fileInputRef} onPick={uploadImage} />

      <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 text-[11px]">
        {archived ? (
          <button
            type="button"
            onClick={() => setActive(true)}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 font-medium text-emerald-700 hover:bg-emerald-50"
          >
            <Eye size={12} /> Restaurar
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={togglePublish}
              disabled={pubBusy}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {product?.is_published ? <EyeOff size={12} /> : <Eye size={12} />}
              {product?.is_published ? "Ocultar" : "Publicar"}
            </button>
            {product?.is_published && product.website_url && (
              <a
                href={product.website_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50"
              >
                <ExternalLink size={12} /> Ver
              </a>
            )}
          </>
        )}
        <button
          type="button"
          onClick={destroy}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 font-medium text-rose-600 hover:bg-rose-50"
        >
          <Trash2 size={12} /> Borrar
        </button>
      </div>
      {usedIn > 0 && (
        <p className="text-[10px] text-slate-400">
          Usado en {usedIn} orden{usedIn === 1 ? "" : "es"}.
        </p>
      )}
    </section>
  );
}

/* -------- Placeholder card for a type that doesn't exist yet -------- */
function AddTypeCard({
  label,
  family,
  suffix,
  typeValue,
  common,
  onAdded,
}: {
  label: string;
  family: string;
  suffix: string;
  typeValue: string;
  common: {
    description: string;
    allowed_colors: string;
    allowed_glass_types: string;
    allowed_brand_ids: number[];
  };
  onAdded: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function add() {
    if (busy) return;
    setBusy(true);
    try {
      const dcode = `${family}-${suffix}`;
      const r = await fetch(`/api/catalog/designs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: dcode,
          name: `${family} ${label}`,
          door_type: typeValue,
          ...common,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.id) throw new Error(j.error || "No se pudo crear");
      qc.invalidateQueries({ queryKey: ["catalog-families"] });
      toast.success(`Agregado ${label}. Subile una imagen.`);
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falló");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center">
      <h3 className="text-sm font-semibold text-slate-500">{label}</h3>
      <p className="text-[11px] text-slate-400">Esta versión todavía no existe.</p>
      <Button size="sm" variant="outline" onClick={add} disabled={busy}>
        <Plus size={13} />
        {busy ? "Agregando…" : `Agregar ${label}`}
      </Button>
    </section>
  );
}

/* ============================================================= *
 *  Shared bits                                                  *
 * ============================================================= */
function Breadcrumb({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <Link href="/catalog" className="hover:text-indigo-700">
        <ArrowLeft size={14} className="inline" /> Catalog
      </Link>
      <span>›</span>
      <span className="font-semibold text-slate-800">{label}</span>
    </div>
  );
}

function ColorsField({
  value,
  onToggle,
}: {
  value: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Colores disponibles
      </Label>
      <div className="flex flex-wrap gap-2">
        {COLOR_OPTIONS.map((c) => {
          const on = value.includes(c.value);
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => onToggle(c.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                on
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const COLOR_PILL_STYLE: Record<
  string,
  { bg: string; text: string; dot: string; label: string }
> = {
  white: { bg: "bg-slate-50", text: "text-slate-800", dot: "#fff", label: "White" },
  bronze: { bg: "bg-amber-50", text: "text-amber-800", dot: "#a16207", label: "Bronze" },
  bronze_eco: { bg: "bg-amber-100", text: "text-amber-900", dot: "#854d0e", label: "Bronze ECO" },
  black: { bg: "bg-slate-100", text: "text-slate-900", dot: "#111", label: "Black" },
  custom: { bg: "bg-violet-50", text: "text-violet-700", dot: "#a78bfa", label: "Custom" },
};

function detectColorFromName(name: string): string {
  const lc = (name || "").toLowerCase();
  if (/(bronze[_ -]?eco)/.test(lc)) return "bronze_eco";
  if (/[_ -]black([._-]|$)/.test(lc)) return "black";
  if (/[_ -]white([._-]|$)/.test(lc)) return "white";
  if (/[_ -]bronze([._-]|$)/.test(lc)) return "bronze";
  if (/[_ -]custom([._-]|$)/.test(lc)) return "custom";
  return "";
}

function ImageGallery({
  designId,
  onRetag,
  onDelete,
  uploading,
}: {
  designId: number;
  onRetag: (attId: number, color: string, makeCover?: boolean) => void;
  onDelete: (attId: number) => void;
  uploading: boolean;
}) {
  const { data, isLoading } = useQuery<{
    records: Array<{ id: number; name: string; mimetype: string }>;
  }>({
    queryKey: ["design-images", designId],
    queryFn: () =>
      fetchJson<{ records: Array<{ id: number; name: string; mimetype: string }> }>(
        `/api/catalog/designs/${designId}/images`,
      ),
    staleTime: 30_000,
  });

  const records = data?.records ?? [];
  if (isLoading && records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-5 text-center text-xs text-slate-400">
        Cargando imágenes…
      </div>
    );
  }
  if (records.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 text-slate-400">
        <ImageIcon size={22} />
        <p className="text-[11px]">Sin imágenes — subí una por color.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {records.map((img) => {
        const detected = detectColorFromName(img.name);
        const pill = COLOR_PILL_STYLE[detected];
        return (
          <div
            key={img.id}
            className={`group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${
              uploading ? "opacity-60" : ""
            }`}
          >
            <div className="relative aspect-square overflow-hidden bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/catalog/designs/${designId}/image?att=${img.id}`}
                alt={img.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => onDelete(img.id)}
                className="absolute top-1.5 right-1.5 rounded-md bg-white/95 p-1 text-rose-600 opacity-0 shadow ring-1 ring-slate-200 transition group-hover:opacity-100 hover:bg-rose-50"
                aria-label="Borrar imagen"
                title="Borrar imagen"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <div className="space-y-1.5 p-2">
              <div className="flex flex-wrap items-center gap-1">
                {pill ? (
                  <Badge
                    variant="secondary"
                    className={`text-[10px] font-bold uppercase ${pill.bg} ${pill.text}`}
                  >
                    <span
                      className="mr-1 inline-block h-2 w-2 rounded-full border border-slate-300"
                      style={{ background: pill.dot }}
                    />
                    {pill.label}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] font-medium text-slate-500">
                    Sin color
                  </Badge>
                )}
                <select
                  value={detected}
                  onChange={(e) => onRetag(img.id, e.target.value)}
                  className="ml-auto h-6 rounded-md border border-slate-200 bg-white text-[10px] text-slate-700 focus:border-indigo-400 focus:outline-none"
                  title="Cambiar color"
                >
                  <option value="">Color…</option>
                  {Object.entries(COLOR_PILL_STYLE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => onRetag(img.id, detected, true)}
                className="block w-full rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 transition hover:bg-indigo-100"
                title="Usar como portada (también la imagen pública)"
              >
                ★ Portada
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ImageUploader({
  uploading,
  fileInputRef,
  onPick,
}: {
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File, color: string, makeCover: boolean) => void;
}) {
  const [color, setColor] = useState<string>("");
  const [makeCover, setMakeCover] = useState(false);

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-2.5">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            onPick(f, color, makeCover);
            setMakeCover(false);
          }
          e.target.value = "";
        }}
        className="sr-only"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none"
        >
          <option value="">Color: cualquiera</option>
          {Object.entries(COLOR_PILL_STYLE).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-medium text-slate-700">
          <input
            type="checkbox"
            checked={makeCover}
            onChange={(e) => setMakeCover(e.target.checked)}
            className="accent-indigo-600"
          />
          Portada
        </label>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-indigo-700 px-2 text-xs font-semibold text-white transition hover:bg-indigo-800 disabled:opacity-60"
        >
          <Camera size={13} />
          {uploading ? "Subiendo…" : "Subir imagen"}
        </button>
      </div>
    </div>
  );
}
