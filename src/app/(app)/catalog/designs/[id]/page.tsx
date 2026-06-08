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
  };
  usedIn: number;
  imageUrl: string | null;
}

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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error, refetch } = useQuery<DesignPayload>({
    queryKey: ["design", idStr],
    queryFn: () =>
      fetch(`/api/catalog/designs/${id}`).then((r) => r.json()),
    enabled: !isNew,
  });

  useEffect(() => {
    if (!data?.design) return;
    setCode(data.design.code || "");
    setName(typeof data.design.name === "string" ? data.design.name : "");
    setDoorType(
      typeof data.design.door_type === "string" ? data.design.door_type : "",
    );
    setDescription(
      typeof data.design.description === "string"
        ? data.design.description
        : "",
    );
    setActive(!!data.design.active);
    setDirty(false);
  }, [data]);

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
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Upload failed");
        qc.invalidateQueries({ queryKey: ["design", idStr] });
        return j;
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
    const promise = fetch(`/api/catalog/designs/${id}/image`, {
      method: "DELETE",
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["design", idStr] });
      return j;
    });
    toast.promise(promise, {
      loading: "Removing image…",
      success: "Image removed",
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

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(f);
              e.target.value = "";
            }}
            className="hidden"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadingImage || isNew}
              onClick={() => fileInputRef.current?.click()}
              className="flex-1"
            >
              <Camera size={14} />
              {imageUrl ? "Replace image" : "Add image"}
            </Button>
            {imageUrl && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={deleteImage}
                className="text-rose-600 hover:bg-rose-50"
              >
                <Trash2 size={14} />
              </Button>
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
