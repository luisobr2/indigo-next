import Link from "next/link";
import {
  FileQuestion,
  ArrowLeft,
  LayoutDashboard,
  ListChecks,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 404 inside the authenticated app. Renders WITH the sidebar/topbar from
 * (app)/layout.tsx so the user keeps navigation when they hit a dead
 * URL like /orders/999999 (the [id] page calls notFound()) or when they
 * mistype a route under /catalog/whatever.
 *
 * The root-level not-found.tsx still catches 404s before login.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
        <FileQuestion size={28} />
      </div>
      <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">
        Error 404
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        Page not found
      </h1>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        The page you&apos;re looking for doesn&apos;t exist, was moved, or
        you don&apos;t have permission to see it.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link href="/dashboard" className={cn(buttonVariants({ size: "lg" }))}>
          <LayoutDashboard size={14} />
          Dashboard
        </Link>
        <Link href="/orders" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
          <ListChecks size={14} />
          Orders
        </Link>
        <Link href=".." className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
          <ArrowLeft size={14} />
          Go back
        </Link>
      </div>

      <div className="mt-10 w-full rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-left">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Try one of these
        </p>
        <ul className="grid grid-cols-2 gap-2 text-sm">
          {[
            { href: "/dashboard", label: "Dashboard" },
            { href: "/orders", label: "Orders" },
            { href: "/design-approval", label: "Design Approval" },
            { href: "/measurements", label: "Measurements" },
            { href: "/digitalization", label: "Digitalization" },
            { href: "/cnc-production", label: "CNC Production" },
            { href: "/paint", label: "Paint" },
            { href: "/installations", label: "Installations" },
            { href: "/route-planner", label: "Route Planner" },
            { href: "/catalog", label: "Catalog" },
          ].map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded-lg px-2 py-1.5 text-indigo-700 hover:bg-indigo-50"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
