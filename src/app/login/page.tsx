"use client";

import { Suspense, useRef, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Shield,
  Building2,
  Pencil,
  Brush,
  Hammer,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Quick-login presets for internal testing. Each entry maps to a real
 * Odoo user seeded with password `indigo123`. The `landing` field tells
 * the client where to drop the user after auth — saves the role-routing
 * dance for the manual flow path.
 */
const QUICK_USERS = [
  {
    role: "Manager",
    name: "Majela",
    login: "majela@indigodecors.com",
    password: "indigo123",
    landing: "/dashboard",
    icon: Shield,
    iconColor: "text-indigo-700",
  },
  {
    role: "Office",
    name: "Beatriz",
    login: "oficina@indigodecors.com",
    password: "indigo123",
    landing: "/dashboard",
    icon: Building2,
    iconColor: "text-emerald-600",
  },
  {
    role: "Designer",
    name: "Pedro",
    login: "disenador@indigodecors.com",
    password: "indigo123",
    landing: "/digitalization",
    icon: Pencil,
    iconColor: "text-sky-600",
  },
  {
    role: "Painter",
    name: "Mario",
    login: "pintor@indigodecors.com",
    password: "indigo123",
    landing: "/paint",
    icon: Brush,
    iconColor: "text-orange-600",
  },
  {
    role: "CNC",
    name: "Ramon",
    login: "cnc@indigodecors.com",
    password: "indigo123",
    landing: "/cnc-production",
    icon: Hammer,
    iconColor: "text-violet-600",
  },
  {
    role: "Installer",
    name: "Carlos",
    login: "instalador@indigodecors.com",
    password: "indigo123",
    landing: "/installs",
    icon: Truck,
    iconColor: "text-emerald-700",
  },
] as const;

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function attemptLogin(
    loginVal: string,
    passwordVal: string,
    landing: string,
  ) {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: loginVal, password: passwordVal }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Login failed");
      router.replace(landing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setPassword("");
      requestAnimationFrame(() => passwordRef.current?.focus());
      throw err;
    } finally {
      setBusy(false);
      setPendingRole(null);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await attemptLogin(login, password, next);
    } catch {
      /* attemptLogin already set the error state */
    }
  }

  async function onQuickLogin(u: (typeof QUICK_USERS)[number]) {
    setLogin(u.login);
    setPassword(u.password);
    setPendingRole(u.role);
    try {
      await attemptLogin(u.login, u.password, u.landing);
    } catch {
      /* error already shown */
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="relative h-16 w-16">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/indigo-logo.webp"
              alt="Indigo Decors"
              className="h-full w-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-indigo-900">
            Indigo Decors
          </h1>
          <p className="text-sm text-slate-500">Production ERP</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-100"
        >
          <div className="space-y-2">
            <Label htmlFor="login">Email</Label>
            <Input
              id="login"
              type="email"
              autoComplete="email"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoFocus
              required
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              ref={passwordRef}
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-invalid={!!error}
              className="h-11"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={busy}
            size="lg"
            className="h-11 w-full text-base font-semibold shadow-lg shadow-indigo-700/30"
          >
            {busy && !pendingRole ? "Signing in..." : "Sign in"}
          </Button>

          {/* ---------- Quick login ---------- */}
          <div className="-mt-1">
            <div className="my-4 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <div className="h-px flex-1 bg-slate-200" />
              Quick login (test)
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {QUICK_USERS.map((u) => {
                const Icon = u.icon;
                const isPending = pendingRole === u.role;
                return (
                  <Button
                    key={u.role}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => onQuickLogin(u)}
                    title={`${u.name} · ${u.login}`}
                    className="h-auto flex-col gap-1 py-2 text-xs"
                  >
                    <Icon size={16} className={u.iconColor} />
                    <span className="font-semibold text-slate-800">{u.role}</span>
                    <span className="text-[10px] text-slate-400">
                      {isPending ? "…" : u.name}
                    </span>
                  </Button>
                );
              })}
            </div>
            <p className="mt-3 text-center text-[10px] text-slate-400">
              All test users share password{" "}
              <code className="rounded bg-slate-100 px-1 font-mono">indigo123</code>
            </p>
          </div>

          <p className="text-center text-xs text-slate-400">
            Indigo Decors · Production ERP
          </p>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
