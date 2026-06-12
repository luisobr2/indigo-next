"use client";

import { AlertCircle, Inbox, RefreshCw, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  title = "Nothing here yet",
  message,
  icon: Icon = Inbox,
}: {
  title?: string;
  message?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
        <Icon size={24} />
      </div>
      <h3 className="mb-1 text-sm font-semibold text-slate-800">{title}</h3>
      {message && <p className="text-sm text-slate-500">{message}</p>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  backHref,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  backHref?: string;
}) {
  return (
    <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-10 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
        <AlertCircle size={24} />
      </div>
      <h3 className="mb-1 text-sm font-semibold text-rose-800">{title}</h3>
      {message && <p className="text-sm text-rose-600/80">{message}</p>}
      <div className="mt-5 flex items-center justify-center gap-2">
        {backHref && (
          <Link
            href={backHref}
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "border-rose-200 text-rose-700 hover:bg-rose-50",
            )}
          >
            <ArrowLeft size={14} />
            Back
          </Link>
        )}
        {onRetry && (
          <Button
            type="button"
            size="lg"
            onClick={onRetry}
            className="bg-rose-600 text-white shadow shadow-rose-600/30 hover:bg-rose-700"
          >
            <RefreshCw size={14} />
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
