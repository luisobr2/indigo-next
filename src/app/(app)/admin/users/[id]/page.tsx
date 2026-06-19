"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, UserCog, Save } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TeamUser {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

const ROLES = [
  { value: "manager", label: "Manager — full access" },
  { value: "office", label: "Office / Administration" },
  { value: "designer", label: "Designer (Digitalization)" },
  { value: "cnc", label: "CNC / Router" },
  { value: "painter", label: "Painter" },
  { value: "installer", label: "Installer" },
];

export default function UserFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === "new";
  const router = useRouter();
  const qc = useQueryClient();

  const { data } = useQuery<{ records: TeamUser[] }>({
    queryKey: ["admin-users"],
    queryFn: () => fetchJson<{ records: TeamUser[] }>("/api/admin/users"),
    enabled: !isNew,
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    const u = data?.records.find((x) => x.id === Number(id));
    if (u) {
      setName(u.name);
      setEmail(u.email);
      setRole(u.role);
    }
  }, [data, id, isNew]);

  async function save() {
    if (!name.trim() || !email.trim()) return toast.error("Name and email are required.");
    if (!role) return toast.error("Pick a role.");
    if (isNew && password.length < 6) return toast.error("Password must be at least 6 characters.");
    setBusy(true);
    const p = (isNew
      ? fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, role }),
        })
      : fetch(`/api/admin/users/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, role }),
        })
    )
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || "Failed");
        qc.invalidateQueries({ queryKey: ["admin-users"] });
        router.push("/admin/users");
        return j;
      })
      .finally(() => setBusy(false));
    toast.promise(p, {
      loading: isNew ? "Creating user…" : "Saving…",
      success: isNew ? `${name} created` : `${name} saved`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  return (
    <div className="mx-auto max-w-[700px] space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/admin/users" className="rounded-xl p-1.5 hover:bg-slate-100">
          <ArrowLeft size={18} className="text-slate-500" />
        </Link>
        <UserCog size={26} className="text-indigo-700" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {isNew ? "New user" : name || "Edit user"}
        </h1>
      </div>

      <section className="space-y-4 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="space-y-1.5">
          <Label htmlFor="u-name">Name</Label>
          <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maria Lopez" className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="u-email">Email (login)</Label>
          <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@indigodecors.com" className="h-10" />
        </div>
        {isNew && (
          <div className="space-y-1.5">
            <Label htmlFor="u-pass">Password</Label>
            <Input id="u-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" className="h-10" />
            <p className="text-[11px] text-slate-400">Share it with the user; they can change it later in their profile.</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="u-role">Role</Label>
          <select id="u-role" value={role} onChange={(e) => setRole(e.target.value)}
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100">
            <option value="">— Select role —</option>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <p className="text-[11px] text-slate-400">Defines which screens this user can access.</p>
        </div>
        {!isNew && (
          <p className="text-[11px] text-slate-400">To change the password, use the key icon on the Users list.</p>
        )}
        <div className="flex justify-end pt-1">
          <Button size="lg" onClick={save} disabled={busy}>
            <Save size={14} />
            {busy ? "Saving…" : isNew ? "Create user" : "Save changes"}
          </Button>
        </div>
      </section>
    </div>
  );
}
