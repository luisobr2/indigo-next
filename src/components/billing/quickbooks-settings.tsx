"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { fmtDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface QboStatus {
  configured: boolean;
  connected: boolean;
  environment: "sandbox" | "production" | string;
  company_name: string | false;
  realm_id: string | false;
  connected_at: string | false;
  connected_by: string | false;
  can_connect: boolean;
}

/** What Intuit's return (Odoo's /indigo/qbo/callback) means, for the person. */
const RETURN_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "QuickBooks is connected." },
  denied: { ok: false, text: "QuickBooks wasn't connected: access was not allowed in Intuit." },
  invalid_state: { ok: false, text: "That connection link expired or was already used. Press Connect again." },
  error: { ok: false, text: "QuickBooks couldn't be connected. Try again; if it repeats, check the app keys on the server." },
};

/**
 * Settings → QuickBooks. Who's connected, and Connect / Disconnect (managers).
 * Hidden entirely while the Odoo module isn't installed (404 from the API), so
 * the panel can ship before it.
 */
export function QuickBooksSettings() {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery<{ data: QboStatus } | null>({
    queryKey: ["qbo-status"],
    queryFn: async () => {
      const res = await fetch("/api/quickbooks/status");
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Couldn't load QuickBooks");
      return res.json();
    },
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  // Coming back from Intuit: say how it went, once, and clean the URL.
  const told = useRef(false);
  useEffect(() => {
    if (told.current) return;
    told.current = true;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("qbo");
    if (!result) return;
    const msg = RETURN_MESSAGES[result] ?? RETURN_MESSAGES.error;
    if (msg.ok) toast.success(msg.text);
    else toast.error(msg.text, { duration: 10000 });
    params.delete("qbo");
    const rest = params.toString();
    router.replace(window.location.pathname + (rest ? `?${rest}` : "") + "#quickbooks");
    qc.invalidateQueries({ queryKey: ["qbo-status"] });
  }, [router, qc]);

  async function connect() {
    setBusy(true);
    try {
      const r = await fetchJson<{ data: string }>("/api/quickbooks/connect", { method: "POST" });
      window.location.assign(r.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the connection");
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetchJson("/api/quickbooks/disconnect", { method: "POST" });
      toast.success("QuickBooks disconnected");
      setConfirmOff(false);
      qc.invalidateQueries({ queryKey: ["qbo-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't disconnect");
    } finally {
      setBusy(false);
    }
  }

  const st = q.data?.data;
  if (q.isLoading || !st) return null;

  return (
    <section id="quickbooks" className="scroll-mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Link2 size={18} className="text-indigo-700" /> QuickBooks
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Invoices issued here are copied to QuickBooks Online with the same number, and payments recorded in
            QuickBooks come back here.
          </p>
        </div>
        {st.connected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={13} /> Connected
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Not connected</span>
        )}
      </div>

      {!st.configured ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The QuickBooks app keys aren&apos;t set on the server yet, so it can&apos;t be connected.
        </p>
      ) : st.connected ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Company</dt>
            <dd className="font-medium text-slate-800">{st.company_name || "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Environment</dt>
            <dd className="font-medium text-slate-800">
              {st.environment === "production" ? (
                "Production"
              ) : (
                <span className="text-amber-700">Sandbox (test company)</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Connected</dt>
            <dd className="text-slate-800">
              {st.connected_at ? fmtDateTime(st.connected_at) : "—"}
              {st.connected_by ? ` by ${st.connected_by}` : ""}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-slate-600">
          {st.can_connect
            ? "Connect it with the QuickBooks account that keeps Indigo's books. You'll be sent to Intuit to allow it, and back here after."
            : "A manager can connect it."}
          {st.environment !== "production" && (
            <span className="ml-1 text-amber-700">This server is set to the sandbox (test company).</span>
          )}
        </p>
      )}

      {st.connected && (
        <Link href="/billing/quickbooks" className="mt-4 inline-block text-sm font-medium text-indigo-700 hover:underline">
          Match dealers and products with QuickBooks →
        </Link>
      )}

      {st.can_connect && (
        <div className="mt-4 flex flex-wrap gap-2">
          {st.connected ? (
            <Button variant="outline" onClick={() => setConfirmOff(true)} disabled={busy}>
              <Unlink size={14} /> Disconnect
            </Button>
          ) : (
            <Button onClick={connect} disabled={busy}>
              <Link2 size={14} /> {busy ? "Opening Intuit…" : "Connect to QuickBooks"}
            </Button>
          )}
        </div>
      )}

      <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect QuickBooks?</DialogTitle>
            <DialogDescription>
              New invoices stop going to QuickBooks and payments stop coming back until someone connects it again.
              Nothing already in QuickBooks is changed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOff(false)}>
              Keep it
            </Button>
            <Button onClick={disconnect} disabled={busy} className="bg-rose-600 text-white hover:bg-rose-700">
              {busy ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
