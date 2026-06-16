"use client";

import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Plus, Search, Sparkles, Heart, ChevronRight, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NewOrderFromDesignModal } from "@/components/new-order-from-design-modal";

interface DesignRow {
  id: number;
  code: string;
  name: string;
  door_type: string;
  allowed_colors: string;
  min_width: number;
  max_width: number;
  min_height: number;
  max_height: number;
  hasImage: boolean;
  favorite: boolean;
}

interface SearchPage {
  records: DesignRow[];
  total: number;
}

interface FamilyVariant {
  id: number;
  code: string;
  door_type: string;
  hasImage: boolean;
  favorite: boolean;
  min_width: number;
  max_width: number;
  min_height: number;
  max_height: number;
}

interface FamilyOut {
  family: string;
  variants: FamilyVariant[];
  colors: string[];
  favorite: boolean;
}

const PAGE_SIZE = 40;

const COLOR_LABEL: Record<string, { label: string; dot: string }> = {
  white: { label: "White", dot: "#fff" },
  bronze: { label: "Bronze", dot: "#a16207" },
  bronze_eco: { label: "Bronze ECO", dot: "#854d0e" },
  black: { label: "Black", dot: "#111" },
  custom: { label: "Custom", dot: "#a78bfa" },
};

const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "Single Door",
  DD: "Double Door",
  sidelite: "Door with Sidelites",
};

const VARIANT_ORDER: Record<string, number> = { SD: 0, DD: 1, sidelite: 2 };

/** Mirror of the server familyOf: strip a trailing -SD/-DD/-SDL. */
function familyOf(code: string): string {
  const m = code.match(/^(.+)-(SD|DD|SDL)$/i);
  if (m && m[1].length >= 2) return m[1];
  return code;
}

/**
 * Group already-loaded design rows into families. Search + pagination
 * happen server-side; grouping the accumulated rows here is cheap and
 * stays correct across pages (rows arrive ordered by code, so a family's
 * variants are adjacent and merge into one card).
 */
function groupFamilies(records: DesignRow[]): FamilyOut[] {
  const map = new Map<string, FamilyOut>();
  for (const d of records) {
    const family = familyOf(d.code);
    const colors = (d.allowed_colors || "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    const variant: FamilyVariant = {
      id: d.id,
      code: d.code,
      door_type: d.door_type || "",
      hasImage: d.hasImage,
      favorite: d.favorite,
      min_width: d.min_width,
      max_width: d.max_width,
      min_height: d.min_height,
      max_height: d.max_height,
    };
    const e = map.get(family);
    if (e) {
      e.variants.push(variant);
      for (const c of colors) if (!e.colors.includes(c)) e.colors.push(c);
      if (variant.favorite) e.favorite = true;
    } else {
      map.set(family, {
        family,
        variants: [variant],
        colors,
        favorite: variant.favorite,
      });
    }
  }
  const out = Array.from(map.values());
  for (const f of out) {
    f.variants.sort(
      (a, b) =>
        (VARIANT_ORDER[a.door_type] ?? 99) - (VARIANT_ORDER[b.door_type] ?? 99),
    );
  }
  // Pin CUSTOM to the top — the "design without a design" for one-offs.
  return out.sort((a, b) => {
    const ac = a.family.toUpperCase() === "CUSTOM" ? -1 : 0;
    const bc = b.family.toUpperCase() === "CUSTOM" ? -1 : 0;
    return ac - bc;
  });
}

/**
 * "New Order" entry point for the Orders page. Two-step flow:
 *   1. Search + pick a design (server-side search, paginated).
 *   2. Fill in the order essentials via the shared NewOrderFromDesignModal.
 * Render only for roles allowed to create orders (manager/office/admin);
 * POST /api/orders enforces the same gate server-side.
 */
export function NewOrderButton() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedFamily, setSelectedFamily] = useState<FamilyOut | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  // Debounce so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery<SearchPage>({
    queryKey: ["new-order-design-search", debouncedQ],
    queryFn: ({ pageParam }) => {
      const url = new URL(
        "/api/catalog/designs/search",
        window.location.origin,
      );
      if (debouncedQ) url.searchParams.set("q", debouncedQ);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(pageParam ?? 0));
      return fetch(url).then((r) => r.json());
    },
    enabled: pickerOpen,
    initialPageParam: 0,
    getNextPageParam: (_last, allPages) => {
      const loaded = allPages.reduce((n, p) => n + (p.records?.length ?? 0), 0);
      const total = allPages[0]?.total ?? 0;
      return loaded < total ? loaded : undefined;
    },
    staleTime: 60_000,
  });

  const records = useMemo(
    () => data?.pages.flatMap((p) => p.records ?? []) ?? [],
    [data],
  );
  const families = useMemo(() => groupFamilies(records), [records]);
  const total = data?.pages[0]?.total ?? 0;

  return (
    <>
      <Button
        size="lg"
        onClick={() => setPickerOpen(true)}
        className="bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
      >
        <Plus size={16} /> New Order
      </Button>

      {/* Step 1 — design picker (server-side search) */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-2xl h-[85vh] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={16} className="text-indigo-700" />
              New order — pick a design
            </DialogTitle>
            <DialogDescription>
              Choose the door model to start the order. You can add more doors
              and edit details after it&apos;s created.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search
              size={16}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            />
            <Input
              autoFocus
              placeholder="Search by design code or name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-10 pl-10 pr-9"
            />
            {isFetching && !isFetchingNextPage && (
              <Loader2
                size={16}
                className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-slate-400"
              />
            )}
          </div>

          <div className="flex items-center justify-between px-0.5 text-[11px] text-slate-400">
            <span>
              {total} design{total === 1 ? "" : "s"}
              {debouncedQ ? ` match “${debouncedQ}”` : " available"}
            </span>
            {q.trim() && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="font-medium text-indigo-600 hover:underline"
              >
                Clear search
              </button>
            )}
          </div>

          {/* min-h-0 lets this flex child shrink so overflow-y-auto scrolls. */}
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 scrollbar-thin">
            {isLoading && (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-400">
                <Loader2 size={16} className="animate-spin" /> Loading catalog…
              </div>
            )}
            {!isLoading && families.length === 0 && (
              <div className="p-10 text-center text-sm text-slate-400">
                {debouncedQ
                  ? `No designs match “${debouncedQ}”.`
                  : "No designs found."}
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {families.map((f) => {
                const isCustom = f.family.toUpperCase() === "CUSTOM";
                const thumb = f.variants.find((v) => v.hasImage);
                return (
                  <li key={f.family}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFamily(f);
                        setPickerOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-2 py-2.5 text-left transition hover:bg-indigo-50/50"
                    >
                      <div
                        className={cn(
                          "h-12 w-12 flex-none overflow-hidden rounded-md ring-1",
                          isCustom
                            ? "bg-indigo-50 ring-indigo-200"
                            : "bg-slate-50 ring-slate-200",
                        )}
                      >
                        {thumb ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={`/api/catalog/designs/${thumb.id}/image`}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-slate-300">
                            {isCustom ? (
                              <Sparkles size={16} className="text-indigo-500" />
                            ) : null}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "font-mono text-sm font-bold",
                              isCustom ? "text-indigo-800" : "text-slate-800",
                            )}
                          >
                            {f.family}
                          </span>
                          {f.favorite && (
                            <Heart
                              size={11}
                              className="text-rose-500"
                              fill="currentColor"
                            />
                          )}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          {isCustom
                            ? "Attach your own design"
                            : f.variants
                                .map(
                                  (v) =>
                                    DOOR_TYPE_LABEL[v.door_type] ?? v.door_type,
                                )
                                .join(", ")}
                          {f.colors.length > 0 &&
                            ` · ${f.colors
                              .map((c) => COLOR_LABEL[c]?.label ?? c)
                              .join(", ")}`}
                        </div>
                      </div>
                      <ChevronRight
                        size={16}
                        className="flex-none text-slate-300"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>

            {hasNextPage && (
              <div className="px-2 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={isFetchingNextPage}
                  onClick={() => fetchNextPage()}
                >
                  {isFetchingNextPage ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Loading…
                    </>
                  ) : (
                    `Load more (${total - records.length} left)`
                  )}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Step 2 — order form (shared with Catalog) */}
      {selectedFamily && (
        <NewOrderFromDesignModal
          open={!!selectedFamily}
          onClose={() => setSelectedFamily(null)}
          family={selectedFamily.family}
          variants={selectedFamily.variants.map((v) => ({
            id: v.id,
            code: v.code,
            door_type: v.door_type,
            min_width: v.min_width,
            max_width: v.max_width,
            min_height: v.min_height,
            max_height: v.max_height,
          }))}
          colors={selectedFamily.colors}
        />
      )}
    </>
  );
}
