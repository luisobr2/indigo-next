/**
 * Re-export shadcn's Skeleton so existing callers keep working.
 * The shadcn primitive uses --color-accent for the shimmer, which our
 * theme overrides to a soft Indigo tint.
 */
export { Skeleton } from "@/components/ui/skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export function KpiSkeleton() {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <Skeleton className="h-11 w-11 rounded-2xl" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Skeleton className="h-80 rounded-2xl lg:col-span-5" />
        <Skeleton className="h-80 rounded-2xl lg:col-span-4" />
        <Skeleton className="h-80 rounded-2xl lg:col-span-3" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex gap-4 border-b border-slate-100 px-4 py-3 last:border-0"
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function OrderDetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-4 w-40" />
      <div className="flex items-end justify-between">
        <Skeleton className="h-10 w-80" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24 rounded-xl" />
          <Skeleton className="h-10 w-40 rounded-xl" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-9">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
        <div className="space-y-5 lg:col-span-3">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
