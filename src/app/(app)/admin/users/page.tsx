"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, KeyRound, Power, Pencil } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface TeamUser {
  id: number;
  name: string;
  login: string;
  email: string;
  active: boolean;
  role: string;
  role_label: string;
}

const ROLE_BADGE: Record<string, string> = {
  manager: "bg-indigo-50 text-indigo-700",
  office: "bg-sky-50 text-sky-700",
  designer: "bg-violet-50 text-violet-700",
  cnc: "bg-amber-50 text-amber-700",
  painter: "bg-rose-50 text-rose-700",
  installer: "bg-emerald-50 text-emerald-700",
};

export default function UsersAdminPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<{ records: TeamUser[] }>({
    queryKey: ["admin-users"],
    queryFn: () => fetchJson<{ records: TeamUser[] }>("/api/admin/users"),
    retry: 1,
  });

  const users = data?.records ?? [];

  function act(u: TeamUser, body: Record<string, unknown>, loading: string, ok: string) {
    const p = fetch(`/api/admin/users/${u.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      return j;
    });
    toast.promise(p, { loading, success: ok, error: (e) => (e instanceof Error ? e.message : "Failed") });
  }

  function resetPassword(u: TeamUser) {
    const pwd = window.prompt(`New password for ${u.name}:`);
    if (!pwd) return;
    if (pwd.length < 6) return toast.error("Password must be at least 6 characters.");
    act(u, { action: "reset_password", password: pwd }, "Updating…", "Password updated");
  }

  function toggleActive(u: TeamUser) {
    const verb = u.active ? "Deactivate" : "Reactivate";
    if (!window.confirm(`${verb} ${u.name}?`)) return;
    act(u, { action: "set_active", active: !u.active }, "Saving…", `${u.name} ${u.active ? "deactivated" : "reactivated"}`);
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={28} className="text-indigo-700" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Users</h1>
            <p className="text-sm text-slate-500">Team members and their roles.</p>
          </div>
        </div>
        <Link href="/admin/users/new">
          <Button size="lg"><Plus size={14} /> New user</Button>
        </Link>
      </div>

      {isLoading && <div className="p-12 text-center text-slate-400">Loading…</div>}
      {isError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700">
          Couldn&apos;t load users.{" "}
          <button className="underline" onClick={() => refetch()}>Retry</button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`border-b border-slate-50 last:border-0 ${u.active ? "" : "opacity-50"}`}>
                  <td className="px-4 py-3 font-medium text-slate-800">{u.name}</td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className={ROLE_BADGE[u.role] ?? "bg-slate-100 text-slate-600"}>
                      {u.role_label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {u.active ? (
                      <span className="text-emerald-700">Active</span>
                    ) : (
                      <span className="text-slate-400">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/admin/users/${u.id}`} title="Edit"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-700">
                        <Pencil size={15} />
                      </Link>
                      <button title="Reset password" onClick={() => resetPassword(u)}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-700">
                        <KeyRound size={15} />
                      </button>
                      <button title={u.active ? "Deactivate" : "Reactivate"} onClick={() => toggleActive(u)}
                        className={`rounded-lg p-1.5 hover:bg-slate-100 ${u.active ? "text-slate-500 hover:text-rose-700" : "text-emerald-600"}`}>
                        <Power size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No users.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
