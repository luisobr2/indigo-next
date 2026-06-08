import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-10 text-center shadow-xl ring-1 ring-slate-100">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
          <FileQuestion size={28} />
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">
          Error 404
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className={cn(buttonVariants({ size: "lg" }), "mt-6 shadow-indigo-700/30")}
        >
          <ArrowLeft size={14} />
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
