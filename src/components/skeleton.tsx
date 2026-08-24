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

/**
 * Loading shape for a KPI row plus a table and a side rail — the layout the
 * Installers screen (and anything built like it) settles into.
 *
 * Mirrors the real geometry on purpose. A centred "Loading…" occupies a box
 * of a different size than the content that replaces it, so the page jumps
 * the moment data lands; the eye has to re-find everything. Reserving the
 * right space means the skeleton dissolves into the content instead.
 */
export function BoardSkeleton({
  kpis = 4,
  rows = 6,
  cols = 7,
  rail = true,
}: {
  kpis?: number;
  rows?: number;
  cols?: number;
  rail?: boolean;
}) {
  return (
    <div aria-busy="true" aria-live="polite">
      {/* Anunciado para lectores de pantalla: sin esto, quien no ve la
          animacion no recibe ninguna senal de que algo esta pasando. */}
      <span className="sr-only">Loading…</span>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: kpis }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3"
          >
            <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </div>
        ))}
      </div>
      <div className={rail ? "grid gap-4 lg:grid-cols-[1fr_320px]" : ""}>
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Skeleton className="mr-auto h-4 w-28" />
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex gap-4 border-b border-slate-50 px-4 py-2.5 last:border-0">
              {Array.from({ length: cols }).map((_, c) => (
                <Skeleton key={c} className={c === 0 ? "h-4 w-32 shrink-0" : "h-4 flex-1"} />
              ))}
            </div>
          ))}
        </div>
        {rail && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
