"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, CheckCircle2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { m2o } from "@/lib/utils";

export default function InstallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data, isLoading } = useQuery<{
    order: Record<string, unknown>;
    lines: Record<string, unknown>[];
  }>({
    queryKey: ["install", id],
    queryFn: () => fetch(`/api/orders/${id}`).then((r) => r.json()),
  });

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoNote, setPhotoNote] = useState("");

  async function uploadPhoto(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!photoFile) {
      toast.warning("Choose a photo first");
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append("file", photoFile);
    if (photoNote) fd.append("note", photoNote);

    const promise = fetch(`/api/orders/${id}/attachments`, {
      method: "POST",
      body: fd,
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed");
      setPhotoFile(null);
      setPhotoNote("");
      // Reset the file input so the same file can be picked again.
      const form = e.target as HTMLFormElement;
      form.reset();
      return j;
    }).finally(() => setUploading(false));

    toast.promise(promise, {
      loading: "Uploading…",
      success: "Photo uploaded ✓",
      error: (err) => (err instanceof Error ? err.message : "Failed"),
    });
  }

  async function submit() {
    setBusy(true);
    try {
      const r = await fetch(`/api/orders/${id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wizard: "indigo.installed.wizard",
          payload: {},
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Submit failed");
      toast.success("Marked as installed");
      setDone(true);
      setTimeout(() => router.push("/installs"), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (isLoading) return <div className="p-8 text-center">Loading...</div>;
  if (!data?.order)
    return (
      <div className="p-8 text-center text-rose-700">Order not found</div>
    );

  const o = data.order as {
    name: string;
    client_name: string;
    client_phone: string;
    client_address: string;
    door_count: number;
    stage_code: string;
    stage_id: [number, string] | false;
  };

  return (
    <div className="mx-auto max-w-2xl">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-indigo-700 px-4 py-3 text-white shadow">
        <Link href="/installs" className="-ml-1 rounded p-1 hover:bg-white/10">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-base font-bold">{o.name}</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          className="ml-auto text-white hover:bg-white/10 hover:text-white"
        >
          <LogOut size={14} />
          Log out
        </Button>
      </header>

      <div className="space-y-4 px-4 py-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">Customer</div>
          <div className="text-lg font-bold text-slate-900">
            {o.client_name}
          </div>
          {o.client_phone && (
            <div className="mt-1 text-sm">
              <a
                href={`tel:${o.client_phone}`}
                className="text-indigo-700 hover:underline"
              >
                {o.client_phone}
              </a>
            </div>
          )}
          {o.client_address && (
            <div className="mt-2 whitespace-pre-line text-sm text-slate-700">
              {o.client_address}
            </div>
          )}
          <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
            <span>{o.door_count} doors</span>
            <Badge variant="secondary" className="bg-indigo-50 font-bold uppercase text-indigo-700">
              {m2o(o.stage_id)?.name ?? o.stage_code}
            </Badge>
          </div>
        </div>

        {/* Photo upload */}
        <form
          onSubmit={uploadPhoto}
          className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
        >
          <div className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
            <Camera size={16} className="text-indigo-700" />
            Upload work photo
          </div>
          {/*
            Native <input type="file"> instead of the shadcn Input wrapper.
            Base UI's Input swallows the native file-picker click behavior
            on certain mobile browsers, so we drop down to plain HTML for
            this single field. Hidden + label-wrapped so we get a big tap
            target that's friendly on phones.
          */}
          <label
            htmlFor="install-photo"
            className="flex h-12 w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 transition active:bg-slate-50"
          >
            <Camera size={16} className="text-indigo-600" />
            {photoFile ? (
              <span className="truncate text-slate-900">{photoFile.name}</span>
            ) : (
              <span>Take or pick a photo…</span>
            )}
          </label>
          {/*
            No `capture` attribute on purpose. With capture="environment" the
            phone opens the rear camera ONLY and hides the photo library / files,
            so an installer can't attach a photo they already took — and in-app
            browsers (WhatsApp, where the install link is shared) often fail to
            return any file at all when capture is set. Plain accept="image/*"
            lets the native picker offer Take Photo + Photo Library + Files,
            matching the "Take or pick a photo" label above.
          */}
          <input
            id="install-photo"
            type="file"
            accept="image/*"
            onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <Input
            type="text"
            value={photoNote}
            onChange={(e) => setPhotoNote(e.target.value)}
            placeholder="Note (optional)"
            className="mt-2"
          />
          <Button
            type="submit"
            size="lg"
            disabled={uploading || !photoFile}
            className="mt-3 h-12 w-full text-base"
          >
            {uploading ? "Uploading…" : "Upload photo"}
          </Button>
        </form>

        {/* Mark installed */}
        {o.stage_code !== "installed" && (
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-2 font-semibold text-slate-800">
              Mark as installed
            </div>
            <p className="mb-3 text-sm text-slate-600">
              Confirm the installation is complete. The order moves
              to <strong>Installed</strong>.
            </p>
            <Button
              size="lg"
              onClick={submit}
              disabled={busy || done}
              className="mt-3 h-12 w-full text-base bg-emerald-600 text-white shadow shadow-emerald-600/20 hover:bg-emerald-700"
            >
              <CheckCircle2 size={16} />
              {done
                ? "Done — returning to list..."
                : busy
                  ? "Submitting..."
                  : "Confirm installation completed"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
