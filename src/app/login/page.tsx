"use client";

import { Suspense, useRef, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Login failed");
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      // Focus the password field so the user can immediately retype —
      // avoids the friction of "click into field" after a failed attempt.
      setPassword("");
      requestAnimationFrame(() => passwordRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 px-4">
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
            {busy ? "Signing in..." : "Sign in"}
          </Button>

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
