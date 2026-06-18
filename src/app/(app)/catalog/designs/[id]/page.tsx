"use client";

import { use, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Save,
  Trash2,
  Camera,
  Archive,
  Image as ImageIcon,
  Boxes,
  Hash,
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
    min_width?: number;
    max_width?: number;
    min_height?: number;
    max_height?: number;
  };
  usedIn: number;
  imageUrl: string | null;
  supportsVariations: boolean;
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

const DOOR_TYPES = [
  { value: "SD", label: "Single Door" },
  { value: "DD", label: "Double Door" },
  { value: "sidelite", label: "Door with Sidelites" },
] as const;

const doorTypeLabel = (v: string) =>
  DOOR_TYPES.find((t) => t.value === v)?.label ?? "";

/** Big, unmissable badge that reflects the REAL door type (not the free-text
 *  display name). Driven by live state so it's always truthful. */
function DoorTypeBadge({ type }: { type: string }) {
  const label = doorTypeLabel(type);
  if (!label) return null;
  const styles: Record<string, string> = {
    SD: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    DD: "bg-amber-50 text-amber-700 ring-amber-200",
    sidelite: "bg-teal-50 text-teal-700 ring-teal-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold ring-1 ${
        styles[type] ?? "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      {label}
    </span>
  );
}

export default function DesignEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  const isNew = idStr === "new";
  const id = isNew ? 0 : Number(idStr);
  const router = useRouter();
  const qc = useQueryClient();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [doorType, setDoorType] = useState<string>("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [allowedColors, setAllowedColors] = useState<string[]>([]);
  const [allowedGlassTypes, setAllowedGlassTypes] = useState<string>("");
  const [allowedBrandIds, setAllowedBrandIds] = useState<number[]>([]);
  const [minWidth, setMinWidth] = useState<string>("");
  const [maxWidth, setMaxWidth] = useState<string>("");
  const [minHeight, setMinHeight] = useState<string>("");
  const [maxHeight, setMaxHeight] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  // Tracks whether the user hand-edited the display name. While false, the
  // name auto-fills from code + door type (it's only a label anyway).
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const brandsQ = useQuery<{ records: Brand[] }>({
    queryKey: ["catalog-brands"],
    queryFn: () => fetch("/api/catalog/brands").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });

  const { data, isLoading, error, refetch } = useQuery<DesignPayload>({
    queryKey: ["design", idStr],
    queryFn: () => fetchJson<DesignPayload>(`/api/catalog/designs/${id}`),
    enabled: !isNew,
    retry: 1,
  });

  useEffect(() => {
    if (!data?.design) return;
    const d = data.design;
    setCode(d.code || "");
    setName(typeof d.name === "string" ? d.name : "");
    // Preserve a name the design already has; only auto-fill empty ones.
    setNameTouched(typeof d.name === "string" && d.name.trim().length > 0);
    setDoorType(typeof d.door_type === "string" ? d.door_type : "");
    setDescription(typeof d.description === "string" ? d.description : "");
    setActive(!!d.active);
    setAllowedColors(
      typeof d.allowed_colors === "string"
        ? d.allowed_colors.split(",").map((x) => x.trim()).filter(Boolean)
        : [],
    );
    setAllowedGlassTypes(
      typeof d.allowed_glass_types === "string" ? d.allowed_glass_types : "",
    );
    setAllowedBrandIds(Array.isArray(d.allowed_brand_ids) ? d.allowed_brand_ids : []);
    setMinWidth(d.min_width ? String(d.min_width) : "");
    setMaxWidth(d.max_width ? String(d.max_width) : "");
    setMinHeight(d.min_height ? String(d.min_height) : "");
    setMaxHeight(d.max_height ? String(d.max_height) : "");
    setDirty(false);
  }, [data]);

  // Auto-fill the display name from code + door type while the user hasn't
  // customized it — keeps the label truthful without manual typing.
  useEffect(() => {
    if (nameTouched) return;
    const suggested = [code, doorTypeLabel(doorType)].filter(Boolean).join(" ");
    setName((prev) => (prev === suggested ? prev : suggested));
  }, [code, doorType, nameTouched]);

  // Warn before losing unsaved edits on tab close / refresh.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Confirm before in-app navigation away (breadcrumb / back) when dirty.
  function guardNav(e: React.MouseEvent) {
    if (dirty && !confirm("You have unsaved changes. Leave without saving?")) {
      e.preventDefault();
    }
  }

  function toggleColor(value: string) {
    setAllowedColors((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value],
    );
    setDirty(true);
  }

  function toggleBrand(brandId: number) {
    setAllowedBrandIds((prev) =>
      prev.includes(brandId)
        ? prev.filter((b) => b !== brandId)
        : [...prev, brandId],
    );
    setDirty(true);
  }

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  async function save() {
    if (!code) {
      toast.error("Code is required");
      return;
    }
    // Dimension range sanity: min can't exceed max.
    const minW = parseFloat(minWidth) || 0;
    const maxW = parseFloat(maxWidth) || 0;
    const minH = parseFloat(minHeight) || 0;
    const maxH = parseFloat(maxHeight) || 0;
    if (minW && maxW && minW > maxW) {
      toast.error("Min width can't be greater than max width.");
      return;
    }
    if (minH && maxH && minH > maxH) {
      toast.error("Min height can't be greater than max height.");
      return;
    }
    setSaving(true);
    const body = {
      code,
      name,
      door_type: doorType,
      description,
      active,
      allowed_colors: allowedColors.join(","),
      allowed_glass_types: allowedGlassTypes,
      allowed_brand_ids: allowedBrandIds,
      min_width: parseFloat(minWidth) || 0,
      max_width: parseFloat(maxWidth) || 0,
      min_height: parseFloat(minHeight) || 0,
      max_height: parseFloat(maxHeight) || 0,
    };
    try {
      if (isNew) {
        const r = await fetch(`/api/catalog/designs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed");
        toast.success("Design created");
        qc.invalidateQueries({ queryKey: ["catalog-designs"] });
        router.replace(`/catalog/designs/${j.id}`);
      } else {
        const r = await fetch(`/api/catalog/designs/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        toast.success("Design saved");
        qc.invalidateQueries({ queryKey: ["catalog-designs"] });
        qc.invalidateQueries({ queryKey: ["design", idStr] });
        setDirty(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(file: File, color: string, makeCover: boolean) {
    if (isNew) {
      toast.warning("Save the design first, then add the image");
      return;
    }
    setUploadingImage(true);
    const fd = new FormData();
    fd.append("file", file);
    if (color) fd.append("color", color);
    if (makeCover) fd.append("makeCover", "1");
    const promise = fetch(`/api/catalog/designs/${id}/image`, {
      method: "POST",
      body: fd,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Upload failed");
        qc.invalidateQueries({ queryKey: ["design", idStr] });
        qc.invalidateQueries({ queryKey: ["design-images", Number(id)] });
        return j;
      })
      .finally(() => setUploadingImage(false));
    toast.promise(promise, {
      loading: "Uploading…",
      success: (j: { coveredProducts?: number }) =>
        makeCover
          ? j.coveredProducts
            ? "Image added & set as storefront cover"
            : "Image added & set as cover (no storefront product linked yet)"
          : color
            ? `Added ${color} variant`
            : "Image added",
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  async function patchImage(attId: number, color: string, makeCover = false) {
    const promise = fetch(`/api/catalog/designs/${id}/image`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attId, color, makeCover }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["design", idStr] });
      qc.invalidateQueries({ queryKey: ["design-images", Number(id)] });
      return j;
    });
    toast.promise(promise, {
      loading: "Updating…",
      success: (j: { coveredProducts?: number }) =>
        makeCover
          ? j.coveredProducts
            ? "Cover updated — storefront image set"
            : "Cover set, but no storefront product is linked to this design yet"
          : "Tag updated",
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  async function deleteOneImage(attId: number) {
    if (!confirm("Delete this image?")) return;
    const promise = fetch(`/api/catalog/designs/${id}/image?att=${attId}`, {
      method: "DELETE",
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["design", idStr] });
      qc.invalidateQueries({ queryKey: ["design-images", Number(id)] });
      return j;
    });
    toast.promise(promise, {
      loading: "Removing…",
      success: "Image removed",
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  async function deleteImage() {
    if (isNew) return;
    // The DELETE endpoint removes EVERY ir.attachment linked to this
    // design, not just the cover image. Confirm so the user does not
    // wipe a full gallery (4-7 renders) with a single click.
    if (
      !confirm(
        "Remove ALL images from this design? This deletes every uploaded picture, not just the cover.",
      )
    ) {
      return;
    }
    const promise = fetch(`/api/catalog/designs/${id}/image?all=1`, {
      method: "DELETE",
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["design", idStr] });
      qc.invalidateQueries({ queryKey: ["design-images", Number(id)] });
      return j;
    });
    toast.promise(promise, {
      loading: "Removing images…",
      success: "All images removed",
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  async function destroyDesign() {
    if (isNew) return;
    if (
      !confirm(
        "Delete this design permanently? If it's used by any order, the system will refuse and ask you to archive instead.",
      )
    ) {
      return;
    }
    const promise = fetch(`/api/catalog/designs/${id}`, {
      method: "DELETE",
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["catalog-designs"] });
      router.replace("/catalog");
      return j;
    });
    toast.promise(promise, {
      loading: "Deleting…",
      success: "Design deleted",
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  if (!isNew && error) {
    const status = (error as (Error & { status?: number }) | null)?.status;
    const notFound = status === 404;
    return (
      <ErrorState
        title={notFound ? "Design not found" : "Couldn't load design"}
        message={
          notFound
            ? `Design #${idStr} doesn't exist or was removed.`
            : "Something went wrong loading this design. Check your connection and try again."
        }
        backHref="/catalog"
        onRetry={notFound ? undefined : () => refetch()}
      />
    );
  }

  if (!isNew && isLoading) {
    return <div className="p-12 text-center text-slate-400">Loading…</div>;
  }

  const imageUrl = data?.imageUrl ?? null;
  const usedIn = data?.usedIn ?? 0;

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/catalog" className="hover:text-indigo-700" onClick={guardNav}>
          <ArrowLeft size={14} className="inline" /> Catalog
        </Link>
        <span>›</span>
        <span className="font-semibold text-slate-800">
          {isNew ? "New design" : data?.design.code}
        </span>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Boxes size={12} />
            {isNew ? "Create a new design" : `Design · ${data?.design.code}`}
          </div>
          <h1 className="mt-1 flex flex-wrap items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            {isNew ? "New design" : (code || data?.design.code) ?? "Untitled"}
            <DoorTypeBadge type={doorType} />
          </h1>
          {!isNew && usedIn > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Used in <strong>{usedIn}</strong> order line{usedIn === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {!isNew && (
            <Button
              variant="outline"
              size="lg"
              onClick={destroyDesign}
              className="border-rose-200 text-rose-700 hover:bg-rose-50"
            >
              <Trash2 size={14} />
              Delete
            </Button>
          )}
          <Button
            type="button"
            size="lg"
            onClick={save}
            disabled={!dirty && !isNew}
          >
            <Save size={14} />
            {saving ? "Saving…" : isNew ? "Create design" : "Save changes"}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ---------- Form ---------- */}
        <section className="space-y-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm lg:col-span-2">
          <div>
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-500">
              Identity
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="code">
                  <Hash size={12} className="inline" /> Code
                </Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => markDirty(setCode)(e.target.value.toUpperCase())}
                  placeholder="e.g. ID10-SD"
                  className="h-10 font-mono uppercase"
                />
                <p className="text-[11px] text-slate-400">
                  Unique. Convention: <code className="rounded bg-slate-100 px-1">ID##-TYPE</code>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="door-type">Door type</Label>
                {isNew ? (
                  <>
                    <select
                      id="door-type"
                      value={doorType}
                      onChange={(e) => markDirty(setDoorType)(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    >
                      <option value="">— Select —</option>
                      {DOOR_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400">
                      Single or double-door variant. Each type is its own design.
                    </p>
                  </>
                ) : !doorType ? (
                  <>
                    <div className="flex h-10 items-center rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 text-sm font-medium text-indigo-800">
                      Single or Double — chosen on each order
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Flexible design (e.g. CUSTOM). The dealer picks Single or
                      Double when placing the order — it isn&apos;t fixed here.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                      {doorTypeLabel(doorType)}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {doorType === "SD" || doorType === "DD" ? (
                        <>
                          Fixed for this design. To work the{" "}
                          {doorType === "DD" ? "single" : "double"}-door version,
                          open its own card in the catalog (e.g.{" "}
                          <span className="font-medium">
                            {(code || "ID01").replace(/-(SD|DD|SDL|sidelite)$/i, "")}{" "}
                            {doorType === "DD" ? "Single Door" : "Double Door"}
                          </span>
                          ).
                        </>
                      ) : (
                        <>
                          Fixed for this design. Other door types are managed as
                          their own cards in the catalog.
                        </>
                      )}
                    </p>
                  </>
                )}
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => {
                    setNameTouched(true);
                    markDirty(setName)(e.target.value);
                  }}
                  placeholder="e.g. ID10 Single Door"
                  className="h-10"
                />
                <p className="text-[11px] text-slate-400">
                  Just a label shown in lists — the real type is the badge next
                  to the title above. Leave it and it auto-fills from code + type.
                </p>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => markDirty(setDescription)(e.target.value)}
                  rows={3}
                  placeholder="Any noteworthy detail about this model…"
                />
              </div>
            </div>
          </div>

          {/* ---------- Variations ---------- */}
          <div className="border-t border-slate-100 pt-5">
            <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-500">
              Variations
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Restrict what an order line can pick when this design is chosen.
              Leave blank to allow anything.
            </p>

            <div className="space-y-5">
              {/* Colors */}
              <div>
                <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Colors available
                </Label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_OPTIONS.map((c) => {
                    const checked = allowedColors.includes(c.value);
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => toggleColor(c.value)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                          checked
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

              {/* Glass types */}
              <div>
                <Label htmlFor="glass-types" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Glass types available
                </Label>
                <Input
                  id="glass-types"
                  value={allowedGlassTypes}
                  onChange={(e) => markDirty(setAllowedGlassTypes)(e.target.value)}
                  placeholder="e.g. ESW, CGI, Tempered"
                  className="h-10"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  Comma-separated tokens. Empty = free-form glass type field.
                </p>
              </div>

              {/* Compatible brands */}
              <div>
                <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Compatible brands
                </Label>
                {(brandsQ.data?.records ?? []).length === 0 ? (
                  <p className="text-xs italic text-slate-400">Loading brands…</p>
                ) : (
                  <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/40 p-2 scrollbar-thin md:grid-cols-3">
                    {(brandsQ.data?.records ?? []).map((b) => {
                      const checked = allowedBrandIds.includes(b.id);
                      return (
                        <label
                          key={b.id}
                          className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs text-slate-700 hover:bg-white"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBrand(b.id)}
                          />
                          <span className="truncate">{b.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="mt-1 text-[10px] text-slate-400">
                  {allowedBrandIds.length === 0
                    ? "None selected = any brand is allowed."
                    : `${allowedBrandIds.length} selected.`}
                </p>
              </div>

              {/* Dimensions */}
              <div>
                <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Dimension range (inches)
                </Label>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <DimInput
                    label="Min width"
                    value={minWidth}
                    onChange={markDirty(setMinWidth)}
                  />
                  <DimInput
                    label="Max width"
                    value={maxWidth}
                    onChange={markDirty(setMaxWidth)}
                  />
                  <DimInput
                    label="Min height"
                    value={minHeight}
                    onChange={markDirty(setMinHeight)}
                  />
                  <DimInput
                    label="Max height"
                    value={maxHeight}
                    onChange={markDirty(setMaxHeight)}
                  />
                </div>
                <p className="mt-1 text-[10px] text-slate-400">
                  0 = no constraint.
                </p>
              </div>
            </div>
          </div>

          {!isNew && (
            <div className="border-t border-slate-100 pt-5">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                Lifecycle
              </h2>
              <label className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/40 p-3">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => markDirty(setActive)(e.target.checked)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-800">
                    Active in the catalog
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    When inactive, the design hides from the dealer-facing
                    catalog but the order history is preserved.
                  </p>
                </div>
                {!active && (
                  <Badge variant="secondary" className="bg-amber-50 text-amber-700">
                    <Archive size={10} className="inline" /> Archived
                  </Badge>
                )}
              </label>
            </div>
          )}
        </section>

        {/* ---------- Images (gallery) ---------- */}
        <section className="space-y-3 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Images
            </h2>
            {!isNew && (
              <button
                type="button"
                onClick={deleteImage}
                className="text-[10px] font-medium text-rose-600 hover:underline"
              >
                Wipe all
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Upload one image per color variant. The Order Detail page
            shows the variant that matches the ordered color (e.g.{" "}
            <code className="rounded bg-slate-100 px-1">ID15-DD-black.jpg</code>{" "}
            is used when an order with{" "}
            <code className="rounded bg-slate-100 px-1">color = black</code>{" "}
            is opened). Tag the cover so unmatched orders fall back to it.
            <br />
            <strong>★ Set as cover</strong> also becomes the picture shown on
            the public storefront for the linked product.
          </p>

          <ImageGallery
            designId={Number(id)}
            cover={imageUrl}
            disabled={isNew}
            onRetag={patchImage}
            onDelete={deleteOneImage}
            uploading={uploadingImage}
          />

          <ImageUploader
            disabled={isNew || uploadingImage}
            uploading={uploadingImage}
            fileInputRef={fileInputRef}
            onPick={uploadImage}
          />

          {isNew && (
            <p className="text-[11px] text-amber-700">
              Save the design first to enable image upload.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

const COLOR_PILL_STYLE: Record<string, { bg: string; text: string; dot: string; label: string }> = {
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
  cover,
  disabled,
  onRetag,
  onDelete,
  uploading,
}: {
  designId: number;
  cover: string | null;
  disabled: boolean;
  onRetag: (attId: number, color: string, makeCover?: boolean) => void;
  onDelete: (attId: number) => void;
  uploading: boolean;
}) {
  const { data, isLoading } = useQuery<{ records: Array<{ id: number; name: string; mimetype: string }> }>({
    queryKey: ["design-images", designId],
    queryFn: () => fetch(`/api/catalog/designs/${designId}/images`).then((r) => r.json()),
    enabled: !disabled,
    staleTime: 30_000,
  });

  if (disabled) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center text-xs text-slate-400">
        Save the design first to upload images.
      </div>
    );
  }

  const records = data?.records ?? [];
  if (isLoading && records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center text-xs text-slate-400">
        Loading images…
      </div>
    );
  }
  if (records.length === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 text-slate-400">
        <ImageIcon size={24} />
        <p className="text-xs">No images yet — upload one per color variant below.</p>
      </div>
    );
  }

  // Heuristic: an attachment whose bytes match the design's image_1920
  // is the cover. Without a flag from the API we just mark the most
  // recently uploaded one as the assumed cover; users can switch with
  // "Set as cover".
  void cover; // reserved for future cover detection

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {records.map((img) => {
        const detected = detectColorFromName(img.name);
        const pill = COLOR_PILL_STYLE[detected];
        return (
          <div
            key={img.id}
            className={`group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition ${uploading ? "opacity-60" : ""}`}
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
                className="absolute top-1.5 right-1.5 rounded-md bg-white/95 p-1 text-rose-600 shadow ring-1 ring-slate-200 opacity-0 transition group-hover:opacity-100 hover:bg-rose-50"
                aria-label="Delete image"
                title="Delete image"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <div className="space-y-1.5 p-2 text-xs">
              <div className="truncate text-[10px] text-slate-400" title={img.name}>
                {img.name}
              </div>
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
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-medium text-slate-500"
                  >
                    Untagged
                  </Badge>
                )}
                <select
                  value={detected}
                  onChange={(e) => onRetag(img.id, e.target.value)}
                  className="ml-auto h-6 rounded-md border border-slate-200 bg-white text-[10px] text-slate-700 focus:border-indigo-400 focus:outline-none"
                  title="Change color tag"
                >
                  <option value="">Tag…</option>
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
                title="Use this image as the cover — also sets the public storefront image for the linked product"
              >
                ★ Set as cover
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ImageUploader({
  disabled,
  uploading,
  fileInputRef,
  onPick,
}: {
  disabled: boolean;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File, color: string, makeCover: boolean) => void;
}) {
  const [color, setColor] = useState<string>("");
  const [makeCover, setMakeCover] = useState(false);

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        Upload new image
      </div>
      <input
        ref={fileInputRef}
        id="design-image-input"
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
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none"
          disabled={disabled}
        >
          <option value="">Color: Any</option>
          {Object.entries(COLOR_PILL_STYLE).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <label
          className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-medium ${makeCover ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "text-slate-700"}`}
        >
          <input
            type="checkbox"
            checked={makeCover}
            onChange={(e) => setMakeCover(e.target.checked)}
            className="accent-indigo-600"
          />
          Make cover
        </label>
        <label
          htmlFor="design-image-input"
          onClick={(e) => {
            if (disabled) {
              e.preventDefault();
              return;
            }
          }}
          className={`inline-flex h-9 flex-1 cursor-pointer select-none items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition ${
            disabled
              ? "cursor-not-allowed bg-slate-100 text-slate-400"
              : "bg-indigo-700 text-white shadow shadow-indigo-700/20 hover:bg-indigo-800"
          }`}
        >
          <Camera size={14} />
          {uploading ? "Uploading…" : "Pick & upload"}
        </label>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">
        File name gets the color suffix automatically (e.g.{" "}
        <code className="bg-slate-100 px-1">door-black.jpg</code>).
      </p>
    </div>
  );
}

function DimInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <Input
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="h-9 text-sm"
      />
    </div>
  );
}
