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

/**
 * Skeleton ROWS, for dropping inside a <tbody> that already exists.
 *
 * TableSkeleton renders its own <div> chrome, which cannot go inside a
 * table. Most screens here already have the table markup and only need the
 * body filled while the fetch is in flight, so this returns <tr>s and
 * nothing else.
 *
 * `cols` should match the real column count: a skeleton with the wrong
 * number of cells shifts the header widths and the table jumps anyway,
 * which is the whole thing this exists to avoid.
 */
export function TableRowsSkeleton({
  rows = 6,
  cols = 5,
  label = "Loading…",
}: {
  rows?: number;
  cols?: number;
  label?: string;
}) {
  return (
    <>
      <tr aria-busy="true" aria-live="polite">
        <td className="p-0">
          <span className="sr-only">{label}</span>
        </td>
      </tr>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t border-slate-50">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-3 py-2.5">
              <Skeleton className={c === 0 ? "h-4 w-32" : "h-4 w-full"} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * Card-grid loading shape, for screens that lay content out as tiles rather
 * than rows (the catalog, the route planner's stops).
 */
export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <span className="sr-only">Loading…</span>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Board columns, for the Kanban while its stages load. */
export function KanbanSkeleton({ columns = 5, cards = 3 }: { columns?: number; cards?: number }) {
  return (
    <>
      <span className="sr-only" aria-busy="true" aria-live="polite">
        Loading board…
      </span>
      {Array.from({ length: columns }).map((_, c) => (
        <div key={c} className="flex w-72 shrink-0 flex-col gap-2 rounded-2xl bg-slate-50/70 p-2">
          <div className="flex items-center justify-between px-1 py-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-6 rounded-full" />
          </div>
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
