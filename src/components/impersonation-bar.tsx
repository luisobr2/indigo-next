"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { UserCog, EyeOff } from "lucide-react";
import { toast } from "sonner";

interface MeResponse {
  user: { id: number; name: string; login: string } | null;
  impersonating?: {
    original: { id: number; name: string; login: string };
  } | null;
}

/**
 * Thin "Viewing as X — Exit" bar for the installer experience.
 *
 * The (app) shell has its own exit banner, but installer pages render in the
 * bare (installer) layout. Without this, a manager who does "View as
 * installer" (now landing on /installs) would have no way back to their own
 * session. Mirrors AppShell's exitImpersonation.
 */
export function ImpersonationBar() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery<MeResponse>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then((r) => r.json()),
  });

  const impersonating = data?.impersonating ?? null;
  if (!impersonating) return null;

  async function exitImpersonation() {
    const promise = fetch("/api/auth/impersonate", { method: "DELETE" }).then(
      async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed");
        await qc.invalidateQueries({ queryKey: ["me"] });
        router.replace("/dashboard");
        return j;
      },
    );
    toast.promise(promise, {
      loading: "Restoring session...",
      success: (j) => `Back as ${j.user.name}`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  return (
    <div className="flex items-center gap-3 bg-amber-50 px-4 py-2 text-xs text-amber-900">
      <UserCog size={14} className="shrink-0 text-amber-700" />
      <div className="min-w-0 flex-1 truncate">
        Viewing as <strong className="font-bold">{data?.user?.name ?? ""}</strong>
        <span className="ml-1.5 hidden text-amber-700/80 sm:inline">
          · original: {impersonating.original.name} ({impersonating.original.login})
        </span>
      </div>
      <button
        type="button"
        onClick={exitImpersonation}
        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900 transition hover:bg-amber-100"
      >
        <EyeOff size={12} />
        Exit
      </button>
    </div>
  );
}
