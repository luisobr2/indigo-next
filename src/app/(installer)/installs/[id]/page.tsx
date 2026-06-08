"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, use, useRef, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, CheckCircle2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Refs avoid the stale-closure bug: keeping `drawing` and `lastX/lastY`
  // as state would re-create the listeners on each setState, losing the
  // `lastX/lastY` set in the synchronous mousedown handler.
  const drawingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoNote, setPhotoNote] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#1f4486";
    ctx.lineCap = "round";

    function pos(e: MouseEvent | TouchEvent) {
      const r = canvas!.getBoundingClientRect();
      const t = "touches" in e ? e.touches[0] : (e as MouseEvent);
      return {
        x: ((t.clientX - r.left) * canvas!.width) / r.width,
        y: ((t.clientY - r.top) * canvas!.height) / r.height,
      };
    }
    function start(e: MouseEvent | TouchEvent) {
      drawingRef.current = true;
      const p = pos(e);
      lastRef.current = p;
      e.preventDefault();
    }
    function move(e: MouseEvent | TouchEvent) {
      if (!drawingRef.current) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(lastRef.current.x, lastRef.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastRef.current = p;
      setHasInk(true);
      e.preventDefault();
    }
    function end() {
      drawingRef.current = false;
    }
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseup", end);
    canvas.addEventListener("mouseleave", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
    canvas.addEventListener("touchcancel", end);
    return () => {
      canvas.removeEventListener("mousedown", start);
      canvas.removeEventListener("mousemove", move);
      canvas.removeEventListener("mouseup", end);
      canvas.removeEventListener("mouseleave", end);
      canvas.removeEventListener("touchstart", start);
      canvas.removeEventListener("touchmove", move);
      canvas.removeEventListener("touchend", end);
      canvas.removeEventListener("touchcancel", end);
    };
  }, []);

  function clearSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

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
      const canvas = canvasRef.current!;
      const signatureDataUrl = hasInk
        ? canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "")
        : "";
      const r = await fetch(`/api/orders/${id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wizard: "indigo.installed.wizard",
          payload: signatureDataUrl
            ? { signature: signatureDataUrl, note: "Signed from portal" }
            : {},
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
              {o.stage_code}
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
          <Input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
          />
          {photoFile && (
            <p className="mt-1 text-xs text-emerald-700">✓ {photoFile.name}</p>
          )}
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
              Ask the customer to sign below. On confirmation the order moves
              to <strong>Installed</strong>.
            </p>
            <canvas
              ref={canvasRef}
              width={500}
              height={180}
              className="w-full touch-none rounded-lg border border-slate-200 bg-white"
              style={{ touchAction: "none" }}
            />
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearSignature}
              >
                Clear signature
              </Button>
              {hasInk && (
                <span className="ml-auto self-center text-[10px] text-emerald-700">
                  ✓ Signature captured
                </span>
              )}
            </div>
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
