"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Save,
  Trash2,
  Hash,
  Archive,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/state-cards";
import { fetchJson } from "@/lib/fetch-json";

interface BrandPayload {
  brand: {
    id: number;
    name: string;
    code: string | false;
    active: boolean;
    notes: string | false;
  };
  usedIn: number;
}

export default function BrandEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  const isNew = idStr === "new";
  const id = isNew ? 0 : Number(idStr);
  const router = useRouter();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<BrandPayload>({
    queryKey: ["brand", idStr],
    queryFn: () => fetchJson<BrandPayload>(`/api/catalog/brands/${id}`),
    enabled: !isNew,
    retry: 1,
  });

  useEffect(() => {
    if (!data?.brand) return;
    setName(data.brand.name);
    setCode(typeof data.brand.code === "string" ? data.brand.code : "");
    setNotes(typeof data.brand.notes === "string" ? data.brand.notes : "");
    setActive(!!data.brand.active);
    setDirty(false);
  }, [data]);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  async function save() {
    if (!name) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    const body = { name, code, notes, active };
    try {
      if (isNew) {
        const r = await fetch(`/api/catalog/brands`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed");
        toast.success("Brand created");
        qc.invalidateQueries({ queryKey: ["catalog-brands"] });
        router.replace(`/catalog/brands/${j.id}`);
      } else {
        const r = await fetch(`/api/catalog/brands/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
        toast.success("Brand saved");
        qc.invalidateQueries({ queryKey: ["catalog-brands"] });
        qc.invalidateQueries({ queryKey: ["brand", idStr] });
        setDirty(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function destroyBrand() {
    if (isNew) return;
    if (!confirm("Delete this brand permanently? If it's used the system will refuse and ask you to archive.")) return;
    const promise = fetch(`/api/catalog/brands/${id}`, { method: "DELETE" }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["catalog-brands"] });
      router.replace("/catalog");
      return j;
    });
    toast.promise(promise, {
      loading: "Deleting…",
      success: "Brand deleted",
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  if (!isNew && error) {
    return (
      <ErrorState
        title="Couldn't load brand"
        message={error instanceof Error ? error.message : "Unknown"}
        backHref="/catalog"
        onRetry={() => refetch()}
      />
    );
  }

  if (!isNew && isLoading) {
    return <div className="p-12 text-center text-slate-400">Loading…</div>;
  }

  const usedIn = data?.usedIn ?? 0;

  return (
    <div className="mx-auto max-w-[800px] space-y-5">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/catalog" className="hover:text-indigo-700">
          <ArrowLeft size={14} className="inline" /> Catalog
        </Link>
        <span>›</span>
        <span className="font-semibold text-slate-800">
          {isNew ? "New brand" : data?.brand.name}
        </span>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Tag size={12} />
            {isNew ? "Create a new brand" : "Brand"}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            {isNew ? "New brand" : name}
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
              onClick={destroyBrand}
              className="border-rose-200 text-rose-700 hover:bg-rose-50"
            >
              <Trash2 size={14} />
              Delete
            </Button>
          )}
          <Button type="button" size="lg" onClick={save} disabled={!dirty && !isNew}>
            <Save size={14} />
            {saving ? "Saving…" : isNew ? "Create brand" : "Save changes"}
          </Button>
        </div>
      </header>

      <section className="space-y-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="b-name">Brand name</Label>
            <Input
              id="b-name"
              value={name}
              onChange={(e) => markDirty(setName)(e.target.value)}
              placeholder="e.g. Pella"
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-code">
              <Hash size={12} className="inline" /> Short code
            </Label>
            <Input
              id="b-code"
              value={code}
              onChange={(e) => markDirty(setCode)(e.target.value)}
              placeholder="e.g. PE"
              className="h-10 font-mono uppercase"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="b-notes">Notes (paint compatibility, tech)</Label>
            <Textarea
              id="b-notes"
              value={notes}
              onChange={(e) => markDirty(setNotes)(e.target.value)}
              rows={3}
              placeholder="e.g. Pella aluminum frames — use bronze-tinted paint only."
            />
            <p className="text-[11px] text-slate-400">
              The brand interferes with the paint type to use. Note any
              constraints so Mario picks the right paint when entering measurements.
            </p>
          </div>
        </div>

        {!isNew && (
          <div className="border-t border-slate-100 pt-5">
            <label className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/40 p-3">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => markDirty(setActive)(e.target.checked)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-800">
                  Active
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  When inactive, the brand hides from the order-line picker but history stays.
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
    </div>
  );
}
