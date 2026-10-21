"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AnotaConfig } from "@/app/api/anota/route";

/**
 * Settings → General → Team notes. Turns the Anota widget on or off for the
 * whole team, with the project key from Anota. Saved on its own.
 */
export function AnotaSettings() {
  const q = useQuery<{ data: AnotaConfig }>({
    queryKey: ["anota"],
    queryFn: () => fetchJson("/api/anota"),
    retry: 1,
  });
  const cfg = q.data?.data;

  if (q.isError) {
    return (
      <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <MessageSquarePlus size={16} className="text-indigo-700" /> Team notes
        </h2>
        <p className="mt-2 text-sm text-rose-700">
          Couldn&apos;t load this setting.{" "}
          <button type="button" onClick={() => q.refetch()} className="font-semibold underline">
            Try again
          </button>
        </p>
      </section>
    );
  }
  if (!cfg || !cfg.canManage) return null;
  // Keyed by the saved values: after a save the form starts again from them.
  return <AnotaForm key={`${cfg.enabled}|${cfg.projectKey ?? ""}`} cfg={cfg} />;
}

function AnotaForm({ cfg }: { cfg: AnotaConfig }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [key, setKey] = useState(cfg.projectKey ?? "");
  const [busy, setBusy] = useState(false);

  const dirty = enabled !== cfg.enabled || key.trim() !== (cfg.projectKey ?? "");

  async function save() {
    const k = key.trim();
    if (enabled && !/^pk_[A-Za-z0-9_-]{8,64}$/.test(k)) {
      toast.error("Add the Anota project key (it starts with pk_) to turn team notes on.");
      return;
    }
    setBusy(true);
    try {
      await fetchJson("/api/anota", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectKey: k, enabled }),
      });
      qc.invalidateQueries({ queryKey: ["anota"] });
      toast.success(enabled ? "Team notes are on. Each person sees the button after reloading the page." : "Team notes are off.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm" aria-labelledby="anota-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="anota-title" className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <MessageSquarePlus size={16} className="text-indigo-700" /> Team notes
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Shows a notes button on every screen of the panel. Anyone on the team can point at something, write
            what should change and send it: it arrives in Anota with a screenshot and the page it was on. Dealers
            never see it.
          </p>
        </div>
        <Button type="button" onClick={save} disabled={!dirty || busy}>
          {busy ? "Saving…" : dirty ? "Save" : "Saved"}
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor="anota-on" className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <input
            id="anota-on"
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium text-slate-900">Show the notes button to the team</span>
            <span className="mt-1 block text-xs text-slate-500">Turning it on or off applies when each person reloads the page.</span>
          </span>
        </label>
        <label htmlFor="anota-key" className="block text-xs text-slate-600">
          Anota project key
          <Input
            id="anota-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="pk_…"
            className="mt-1 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="mt-1 block text-slate-400">
            In Anota: Organization → the project for this panel. Notes are read in{" "}
            <a href={`${cfg.url}/notas`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
              the Anota inbox
            </a>
            .
          </span>
        </label>
      </div>
    </section>
  );
}
