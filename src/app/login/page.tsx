"use client";

import { Suspense, useRef, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function friendlyError(status: number, raw?: string): string {
  const r = (raw || "").toLowerCase();
  if (status === 401 || r.includes("credential") || r.includes("invalid") || r.includes("denied")) {
    return "Incorrect email or password.";
  }
  if (status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (status >= 500) return "We couldn't sign you in right now. Please try again shortly.";
  return raw || "Sign in failed. Please try again.";
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
        body: JSON.stringify({ login: login.trim(), password }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(friendlyError(r.status, data?.error));
        setPassword("");
        requestAnimationFrame(() => passwordRef.current?.focus());
        return;
      }
      router.replace(next);
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/indigo-logo.webp"
              alt="Indigo Decors"
              className="mx-auto h-28 w-auto max-w-[280px] object-contain"
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
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              aria-invalid={!!error}
              autoFocus
              required
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                ref={passwordRef}
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                aria-invalid={!!error}
                className="h-11 pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={busy}
            size="lg"
            className="h-11 w-full text-base font-semibold shadow-lg shadow-indigo-700/30"
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>

          <p className="text-center text-xs text-slate-400">
            Trouble signing in? Contact your administrator.
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} Indigo Publicity Corp · Indigo Decors
        </p>
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
