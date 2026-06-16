"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Sparkles, Heart, ChevronRight } from "lucide-react";
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

interface FamilyVariant {
  id: number;
  code: string;
  door_type: string;
  hasImage: boolean;
  favorite: boolean;
  min_width?: number;
  max_width?: number;
  min_height?: number;
  max_height?: number;
}

interface FamilyOut {
  family: string;
  variants: FamilyVariant[];
  colors: string[];
  favorite: boolean;
}

interface CatalogResponse {
  families: FamilyOut[];
}

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

/**
 * "New Order" entry point for the Orders page. Because an order always
 * starts from a design, this is a two-step flow:
 *   1. Pick a design family (searchable list — same source as Catalog).
 *   2. Fill in the order essentials via the shared NewOrderFromDesignModal.
 * Render this only for roles allowed to create orders (manager/office/admin);
 * the POST /api/orders endpoint enforces the same gate server-side.
 */
export function NewOrderButton() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedFamily, setSelectedFamily] = useState<FamilyOut | null>(null);
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery<CatalogResponse>({
    queryKey: ["catalog-families"],
    queryFn: () => fetch("/api/catalog/designs/families").then((r) => r.json()),
    enabled: pickerOpen,
    staleTime: 60_000,
  });

  const families = useMemo(() => {
    const list = data?.families ?? [];
    const needle = q.toLowerCase().trim();
    const out = needle
      ? list.filter(
          (f) =>
            f.family.toLowerCase().includes(needle) ||
            f.variants.some((v) => v.code.toLowerCase().includes(needle)),
        )
      : list;
    // Pin CUSTOM to the top — the "design without a design" for one-offs.
    return [...out].sort((a, b) => {
      const ac = a.family.toUpperCase() === "CUSTOM" ? -1 : 0;
      const bc = b.family.toUpperCase() === "CUSTOM" ? -1 : 0;
      return ac - bc;
    });
  }, [data, q]);

  return (
    <>
      <Button
        size="lg"
        onClick={() => setPickerOpen(true)}
        className="bg-indigo-700 text-white shadow shadow-indigo-700/30 hover:bg-indigo-800"
      >
        <Plus size={16} /> New Order
      </Button>

      {/* Step 1 — design picker */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
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
              className="h-10 pl-10"
            />
          </div>

          <div className="-mx-1 flex-1 overflow-y-auto px-1 scrollbar-thin">
            {isLoading && (
              <div className="p-10 text-center text-sm text-slate-400">
                Loading catalog…
              </div>
            )}
            {!isLoading && families.length === 0 && (
              <div className="p-10 text-center text-sm text-slate-400">
                No designs match “{q}”.
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
                            : `${f.variants
                                .map((v) => DOOR_TYPE_LABEL[v.door_type] ?? v.door_type)
                                .join(", ")}`}
                          {f.colors.length > 0 &&
                            ` · ${f.colors
                              .map((c) => COLOR_LABEL[c]?.label ?? c)
                              .join(", ")}`}
                        </div>
                      </div>
                      <ChevronRight size={16} className="flex-none text-slate-300" />
                    </button>
                  </li>
                );
              })}
            </ul>
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
