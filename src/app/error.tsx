"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Error boundary for the (app) layout. Catches render-time errors in any
 * page underneath and shows a recoverable fallback so the user keeps the
 * shell + can either retry or go home.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[indigo] page error:", error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-rose-100 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <AlertTriangle size={24} />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Something went wrong</h2>
        <p className="mt-2 text-sm text-slate-500">
          {error.message || "An unexpected error occurred while rendering this page."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[10px] text-slate-400">
            ref: {error.digest}
          </p>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            <Home size={14} />
            Dashboard
          </Link>
          <Button type="button" size="lg" onClick={reset}>
            <RefreshCw size={14} />
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
