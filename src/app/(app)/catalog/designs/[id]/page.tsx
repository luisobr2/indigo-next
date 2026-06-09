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
  { value: "black", label: "Black" },
  { value: "custom", label: "Custom" },
] as const;

const DOOR_TYPES = [
  { value: "SD", label: "Single Door" },
  { value: "DD", label: "Double Door" },
  { value: "sidelite", label: "Door with Sidelites" },
] as const;

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
    queryFn: () =>
      fetch(`/api/catalog/designs/${id}`).then((r) => r.json()),
    enabled: !isNew,
  });

  useEffect(() => {
    if (!data?.design) return;
    const d = data.design;
    setCode(d.code || "");
    setName(typeof d.name === "string" ? d.name : "");
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

  async function uploadImage(file: File) {
    // eslint-disable-next-line no-console
    console.log("[design-image] uploadImage called", {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      designId: id,
      isNew,
    });
    if (isNew) {
      toast.warning("Save the design first, then add the image");
      return;
    }
    setUploadingImage(true);
    const fd = new FormData();
    fd.append("file", file);
    const promise = fetch(`/api/catalog/designs/${id}/image`, {
      method: "POST",
      body: fd,
    })
      .then(async (r) => {
        // eslint-disable-next-line no-console
        console.log("[design-image] upload response", { status: r.status });
        const j = await r.json();
        // eslint-disable-next-line no-console
        console.log("[design-image] upload body", j);
        if (!r.ok || !j.ok) throw new Error(j.error || "Upload failed");
        qc.invalidateQueries({ queryKey: ["design", idStr] });
        return j;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[design-image] upload failed", err);
        throw err;
      })
      .finally(() => setUploadingImage(false));
    toast.promise(promise, {
      loading: "Uploading…",
      success: "Image updated",
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
    const promise = fetch(`/api/catalog/designs/${id}/image`, {
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
    return (
      <ErrorState
        title="Couldn't load design"
        message={error instanceof Error ? error.message : "Unknown"}
        backHref="/catalog"
        onRetry={() => refetch()}
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
        <Link href="/catalog" className="hover:text-indigo-700">
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
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            {isNew ? "New design" : (name || data?.design.code) ?? "Untitled"}
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
                <select
                  id="door-type"
                  value={doorType}
                  onChange={(e) => markDirty(setDoorType)(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="">— None —</option>
                  {DOOR_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => markDirty(setName)(e.target.value)}
                  placeholder="e.g. ID10 Single Door"
                  className="h-10"
                />
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

        {/* ---------- Image ---------- */}
        <section className="space-y-3 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Image
          </h2>
          <p className="text-xs text-slate-500">
            The photo that shows up on the order card, the catalog and the
            dealer-facing page.
          </p>

          <div className="overflow-hidden rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
            {imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={imageUrl}
                alt={`Design ${code}`}
                className="h-56 w-full object-cover"
              />
            ) : (
              <div className="flex h-56 flex-col items-center justify-center gap-2 text-slate-400">
                <ImageIcon size={32} />
                <p className="text-xs">No image yet</p>
              </div>
            )}
          </div>

          {/*
            File picker pattern that works EVERYWHERE:
            - Native <input type="file"> positioned absolutely and styled
              visually invisible (sr-only-like). NOT display:none because
              Safari / Firefox sometimes refuse to programmatically click
              inputs that aren't in the layout tree.
            - <label htmlFor> linked to it — clicking the label fires the
              file picker via the browser's native semantic association.
            - Extra onClick on the label as belt-and-suspenders: some
              browsers also need an explicit click handler when the input
              is inside a parent with pointer-events tweaks.
          */}
          <input
            ref={fileInputRef}
            id="design-image-input"
            type="file"
            accept="image/*"
            onChange={(e) => {
              // eslint-disable-next-line no-console
              console.log("[design-image] input onChange fired", {
                files: e.target.files?.length ?? 0,
              });
              const f = e.target.files?.[0];
              if (f) uploadImage(f);
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
          <div className="flex flex-wrap gap-2">
            <label
              htmlFor="design-image-input"
              onClick={(e) => {
                // eslint-disable-next-line no-console
                console.log("[design-image] label clicked", {
                  isNew,
                  uploadingImage,
                });
                // Block when disabled; otherwise let the native label →
                // input association open the picker. Don't call .click()
                // here — that would fire a SECOND file picker.
                if (isNew) {
                  e.preventDefault();
                  toast.warning("Save the design first, then add the image");
                  return;
                }
                if (uploadingImage) {
                  e.preventDefault();
                }
              }}
              className={`inline-flex h-10 flex-1 cursor-pointer select-none items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition ${
                isNew || uploadingImage
                  ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                  : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-700"
              }`}
            >
              <Camera size={14} />
              {uploadingImage
                ? "Uploading…"
                : imageUrl
                  ? "Replace image"
                  : "Add image"}
            </label>
            {imageUrl && (
              <button
                type="button"
                onClick={deleteImage}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
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
