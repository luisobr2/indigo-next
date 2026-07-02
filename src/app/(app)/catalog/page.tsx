"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Search,
  Download,
  Printer,
  Heart,
  LayoutGrid,
  List,
  Boxes,
  Palette,
  DoorOpen,
  Grid3x3,
  ChevronRight,
  Info,
  ChevronDown,
  FileText,
  LayoutDashboard,
  Sparkles,
  Plus,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  generateCatalogSheetPdf,
  generateDesignSheetsPdf,
  generateComparisonSheetPdf,
} from "@/lib/catalog-pdf";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, fmtNum } from "@/lib/utils";
import { NewOrderFromDesignModal } from "@/components/new-order-from-design-modal";

interface FamilyVariant {
  id: number;
  code: string;
  door_type: string;
  hasImage: boolean;
  favorite: boolean;
  published?: boolean;
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
  summary: {
    totalDesigns: number;
    totalVariations: number;
    availableColors: string[];
    availableConfigs: string[];
  };
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

export default function CatalogPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"all" | "favorites">("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [doorTypeFilter, setDoorTypeFilter] = useState<"all" | "SD" | "DD">("all");
  const [colorFilter, setColorFilter] = useState<"all" | string>("all");
  const [selectedFamily, setSelectedFamily] = useState<FamilyOut | null>(null);

  const { data, isLoading } = useQuery<CatalogResponse>({
    queryKey: ["catalog-families"],
    queryFn: () =>
      fetch("/api/catalog/designs/families").then((r) => r.json()),
    staleTime: 60_000,
  });

  const families = useMemo(() => data?.families ?? [], [data]);
  const summary = data?.summary;

  const filtered = useMemo(() => {
    let out = families;
    if (tab === "favorites") out = out.filter((f) => f.favorite);
    if (doorTypeFilter !== "all") {
      // Keep only families that have a variant of this type, AND show only
      // those variants on the card (otherwise a family with both SD+DD would
      // still render its Single Door config under the "Double Door" filter).
      out = out
        .map((f) => ({
          ...f,
          variants: f.variants.filter((v) => v.door_type === doorTypeFilter),
        }))
        .filter((f) => f.variants.length > 0);
    }
    if (colorFilter !== "all") {
      out = out.filter((f) => f.colors.includes(colorFilter));
    }
    if (q.trim()) {
      const needle = q.toLowerCase().trim();
      out = out.filter(
        (f) =>
          f.family.toLowerCase().includes(needle) ||
          f.variants.some((v) => v.code.toLowerCase().includes(needle)),
      );
    }
    // Pin the CUSTOM family to the very top of the grid. It's the
    // "design without a design" — operators reach for it when the dealer
    // sends a one-off; making them scroll past 30 catalog cards to find
    // it would be friction. Sort is otherwise stable.
    out = [...out].sort((a, b) => {
      const ac = a.family.toUpperCase() === "CUSTOM" ? -1 : 0;
      const bc = b.family.toUpperCase() === "CUSTOM" ? -1 : 0;
      return ac - bc;
    });
    return out;
  }, [families, tab, doorTypeFilter, colorFilter, q]);

  const favoritesCount = families.filter((f) => f.favorite).length;

  async function toggleFavorite(family: FamilyOut) {
    // We toggle ALL variants in the family at once. Optimistic flip on
    // the cached payload so the heart fills/empties immediately.
    const willBeFav = !family.favorite;
    qc.setQueryData<CatalogResponse>(["catalog-families"], (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        families: prev.families.map((f) =>
          f.family === family.family
            ? {
                ...f,
                favorite: willBeFav,
                variants: f.variants.map((v) => ({ ...v, favorite: willBeFav })),
              }
            : f,
        ),
      };
    });
    try {
      await Promise.all(
        family.variants.map((v) =>
          fetch(`/api/catalog/designs/${v.id}/favorite`, {
            method: willBeFav ? "POST" : "DELETE",
          }).then((r) => {
            if (!r.ok) throw new Error("favorite write failed");
          }),
        ),
      );
    } catch {
      // Roll back the cache on failure.
      qc.invalidateQueries({ queryKey: ["catalog-families"] });
      toast.error("Could not update favourite");
    }
  }

  // Publish / hide ALL variants of one family (web visibility), optimistic.
  async function toggleFamilyPublish(family: FamilyOut) {
    const willPublish = !family.variants.every((v) => v.published);
    qc.setQueryData<CatalogResponse>(["catalog-families"], (prev) =>
      prev
        ? {
            ...prev,
            families: prev.families.map((f) =>
              f.family === family.family
                ? { ...f, variants: f.variants.map((v) => ({ ...v, published: willPublish })) }
                : f,
            ),
          }
        : prev,
    );
    try {
      const r = await fetch(`/api/catalog/designs/publish-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ design_ids: family.variants.map((v) => v.id), published: willPublish }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      // Bulk only flips EXISTING products. If a design has no web product yet
      // (count 0 while publishing), revert the optimistic flip + tell the user.
      if (willPublish && j.count === 0) {
        qc.invalidateQueries({ queryKey: ["catalog-families"] });
        toast.warning(`${family.family}: no web product yet — open the design and press Publish.`);
        return;
      }
      toast.success(willPublish ? `${family.family} published` : `${family.family} hidden`);
    } catch {
      qc.invalidateQueries({ queryKey: ["catalog-families"] });
      toast.error("Could not change visibility");
    }
  }

  // Bulk publish/hide everything in the current view (tab + filters + search).
  async function bulkPublishView(publish: boolean) {
    const ids = filtered.flatMap((f) => f.variants.map((v) => v.id));
    if (!ids.length) return toast.warning("Nothing in view");
    if (!confirm(`${publish ? "Publish" : "Hide"} ${ids.length} design(s) in the current view?`)) return;
    const p = fetch(`/api/catalog/designs/publish-bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ design_ids: ids, published: publish }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      qc.invalidateQueries({ queryKey: ["catalog-families"] });
      return j;
    });
    toast.promise(p, {
      loading: publish ? "Publishing…" : "Hiding…",
      success: (j) => `${publish ? "Published" : "Hid"} ${j.count} product(s) on the web`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  // Exports respect the active view (tab + filters + search) so the
  // CSV mirrors what the operator is looking at — not the whole base.
  // Use the "All Designs" tab without filters to dump everything.
  function exportCatalog() {
    const scope = filtered;
    if (!scope.length) return toast.warning("Nothing to export — try clearing filters");
    const lines = [
      "family,code,name,door_type,colors,variants_in_family,has_image,favorite",
    ];
    for (const f of scope) {
      for (const v of f.variants) {
        lines.push(
          [
            f.family,
            v.code,
            `"${(f.family).replace(/"/g, '""')}"`,
            v.door_type,
            f.colors.join("|"),
            f.variants.length,
            v.hasImage ? "1" : "0",
            v.favorite ? "1" : "0",
          ].join(","),
        );
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `catalog-${tab === "favorites" ? "favorites-" : ""}${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    const totalRows = scope.reduce((s, f) => s + f.variants.length, 0);
    toast.success(
      `Exported ${totalRows} design${totalRows === 1 ? "" : "s"} (${scope.length} famil${scope.length === 1 ? "y" : "ies"})`,
    );
  }

  const [printOpen, setPrintOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState<null | "sheet" | "individual" | "comparison">(null);

  // Close the print dropdown on Escape — standard menu pattern that
  // also keeps the backdrop click consistent with keyboard users.
  useEffect(() => {
    if (!printOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPrintOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [printOpen]);

  async function printCatalogSheet(onlyFavorites: boolean) {
    const scope = onlyFavorites
      ? families.filter((f) => f.favorite)
      : filtered;
    if (!scope.length) {
      toast.warning(
        onlyFavorites
          ? "You haven't favourited any designs yet."
          : "Nothing to print — try clearing filters.",
      );
      return;
    }
    setPrintBusy("sheet");
    setPrintOpen(false);
    const promise = generateCatalogSheetPdf(scope, {
      subtitle: onlyFavorites
        ? `${scope.length} favourite designs`
        : `${scope.length} designs · ${filtered === families ? "Full catalog" : "Current view"}`,
      filename: `indigo-catalog-${onlyFavorites ? "favorites-" : ""}${new Date().toISOString().slice(0, 10)}.pdf`,
    }).finally(() => setPrintBusy(null));
    toast.promise(promise, {
      loading: `Building PDF for ${scope.length} designs…`,
      success: "Catalog Sheet ready — check downloads",
      error: "Failed to generate PDF",
    });
  }

  async function printComparison(onlyFavorites: boolean) {
    const scope = onlyFavorites
      ? families.filter((f) => f.favorite)
      : filtered;
    if (scope.length < 2) {
      toast.warning(
        onlyFavorites
          ? "Favorite at least 2 designs to compare."
          : "Need at least 2 designs in view to compare.",
      );
      return;
    }
    if (scope.length > 12) {
      const ok = confirm(
        `Side-by-side compares 4 designs per page. ${scope.length} designs → ${Math.ceil(scope.length / 4)} pages. Continue?`,
      );
      if (!ok) return;
    }
    setPrintBusy("comparison");
    setPrintOpen(false);
    const promise = generateComparisonSheetPdf(scope, {
      filename: `indigo-comparison-${onlyFavorites ? "favorites-" : ""}${new Date().toISOString().slice(0, 10)}.pdf`,
    }).finally(() => setPrintBusy(null));
    toast.promise(promise, {
      loading: `Building comparison sheet for ${scope.length} designs…`,
      success: "Comparison ready — check downloads",
      error: "Failed to generate PDF",
    });
  }

  async function printIndividualSheets(onlyFavorites: boolean) {
    const scope = onlyFavorites
      ? families.filter((f) => f.favorite)
      : filtered;
    if (!scope.length) {
      toast.warning(
        onlyFavorites
          ? "You haven't favourited any designs yet."
          : "Nothing to print — try clearing filters.",
      );
      return;
    }
    // Individual sheets can balloon a PDF quickly — gate at 25 to avoid
    // the browser hanging on huge fetches.
    if (scope.length > 25) {
      const ok = confirm(
        `This will generate ${scope.length} pages (one per design). Continue?`,
      );
      if (!ok) return;
    }
    setPrintBusy("individual");
    setPrintOpen(false);
    const promise = generateDesignSheetsPdf(scope, {
      filename: `indigo-designs-${onlyFavorites ? "favorites-" : ""}${new Date().toISOString().slice(0, 10)}.pdf`,
    }).finally(() => setPrintBusy(null));
    toast.promise(promise, {
      loading: `Building ${scope.length}-page document…`,
      success: "Design Sheets ready — check downloads",
      error: "Failed to generate PDF",
    });
  }

  return (
    <div className="mx-auto max-w-[1700px] space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav className="text-xs text-slate-500">
            <Link href="/dashboard" className="hover:text-slate-700">
              Home
            </Link>
            <span className="mx-1.5">›</span>
            <span className="font-medium text-slate-800">Catalog</span>
          </nav>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
            Catalog
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Browse, create and edit door designs. Click{" "}
            <strong>Select Design</strong> to start a new order, or{" "}
            <strong>View / Edit</strong> to manage a design.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72">
            <Search
              size={16}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            />
            <Input
              placeholder="Search by design code or name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-10 pl-10"
            />
          </div>
          <Link
            href="/catalog/designs/new"
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-indigo-700 px-4 text-sm font-semibold text-white shadow shadow-indigo-700/20 transition hover:bg-indigo-800"
          >
            <Plus size={16} /> New Design
          </Link>
          <Button
            variant="outline"
            size="lg"
            onClick={() => bulkPublishView(true)}
            title="Publish all designs in the current view to the website"
            className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          >
            <Eye size={14} /> Publish view
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => bulkPublishView(false)}
            title="Hide all designs in the current view from the website"
          >
            <EyeOff size={14} /> Hide view
          </Button>
          <Button variant="outline" size="lg" onClick={exportCatalog}>
            <Download size={14} /> Export CSV
          </Button>
          <div className="relative">
            <Button
              variant="outline"
              size="lg"
              disabled={printBusy !== null}
              onClick={() => setPrintOpen((v) => !v)}
            >
              <Printer size={14} /> Print / PDF
              <ChevronDown size={12} className="ml-1 opacity-60" />
            </Button>
            {printOpen && (
              <>
                {/* Backdrop closes the menu on outside click */}
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setPrintOpen(false)}
                />
                <div
                  className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
                  role="menu"
                >
                  <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Catalog Sheet
                  </div>
                  <PrintMenuItem
                    icon={LayoutDashboard}
                    title="Catalog Sheet (current view)"
                    subtitle={`Grid · ${filtered.length} design${filtered.length === 1 ? "" : "s"} · 12 per page`}
                    onClick={() => printCatalogSheet(false)}
                  />
                  <PrintMenuItem
                    icon={Heart}
                    title="Catalog Sheet (favorites)"
                    subtitle={`${favoritesCount} favorite${favoritesCount === 1 ? "" : "s"} · same grid layout`}
                    onClick={() => printCatalogSheet(true)}
                    disabled={favoritesCount === 0}
                  />
                  <div className="border-y border-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Side-by-Side Comparison
                  </div>
                  <PrintMenuItem
                    icon={Grid3x3}
                    title="Comparison (current view)"
                    subtitle={`Landscape · 4 designs per page · ${filtered.length} in view`}
                    onClick={() => printComparison(false)}
                    disabled={filtered.length < 2}
                  />
                  <PrintMenuItem
                    icon={Heart}
                    title="Comparison (favorites)"
                    subtitle={
                      favoritesCount < 2
                        ? "Favorite at least 2 designs to compare"
                        : `${favoritesCount} favorite${favoritesCount === 1 ? "" : "s"} side-by-side`
                    }
                    onClick={() => printComparison(true)}
                    disabled={favoritesCount < 2}
                  />
                  <div className="border-y border-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    One Page Per Design
                  </div>
                  <PrintMenuItem
                    icon={FileText}
                    title="Design Sheets (current view)"
                    subtitle={`Big thumbnail · QR · ${filtered.length} page${filtered.length === 1 ? "" : "s"}`}
                    onClick={() => printIndividualSheets(false)}
                  />
                  <PrintMenuItem
                    icon={Heart}
                    title="Design Sheets (favorites)"
                    subtitle={`${favoritesCount} page${favoritesCount === 1 ? "" : "s"} · for cherry-picked sets`}
                    onClick={() => printIndividualSheets(true)}
                    disabled={favoritesCount === 0}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Total Designs"
          value={fmtNum(summary?.totalDesigns ?? 0)}
          hint="Active families"
          icon={Grid3x3}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-700"
        />
        <KpiTile
          label="Colors"
          value={fmtNum(summary?.availableColors?.length ?? 0)}
          hint={summary?.availableColors?.map((c) => COLOR_LABEL[c]?.label ?? c).join(", ") || "—"}
          icon={Palette}
          iconBg="bg-orange-50"
          iconColor="text-orange-600"
        />
        <KpiTile
          label="Configurations"
          value={fmtNum(summary?.availableConfigs?.length ?? 0)}
          hint={summary?.availableConfigs?.map((c) => DOOR_TYPE_LABEL[c] ?? c).join(", ") || "—"}
          icon={DoorOpen}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
        />
        <KpiTile
          label="Total Variations"
          value={fmtNum(summary?.totalVariations ?? 0)}
          hint={`${summary?.totalDesigns ?? 0} families × ${summary?.availableColors?.length ?? 0} colors × ${summary?.availableConfigs?.length ?? 0} configs`}
          icon={Boxes}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
        />
      </section>

      {/* Body */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* MAIN */}
        <div className="lg:col-span-9">
          {/* Tabs + view toggle */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-100">
            <div className="flex items-center gap-1">
              <TabChip
                label="All Designs"
                active={tab === "all"}
                onClick={() => setTab("all")}
              />
              <TabChip
                label={`My Favorites (${favoritesCount})`}
                active={tab === "favorites"}
                onClick={() => setTab("favorites")}
              />
            </div>
            <div className="flex overflow-hidden rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setView("grid")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition",
                  view === "grid"
                    ? "bg-indigo-700 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                <LayoutGrid size={12} /> Grid View
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition",
                  view === "list"
                    ? "bg-indigo-700 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                <List size={12} /> List View
              </button>
            </div>
          </div>

          {isLoading && (
            <div className="rounded-2xl bg-white p-10 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-100">
              Loading catalog…
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-100">
              <Heart size={28} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-semibold text-slate-700">
                No designs match your filters
              </p>
              <p className="text-xs text-slate-500">
                Reset filters or switch to All Designs.
              </p>
            </div>
          )}

          {view === "grid" ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((f) => (
                <DesignCard
                  key={f.family}
                  family={f}
                  onSelect={() => setSelectedFamily(f)}
                  onToggleFavorite={() => toggleFavorite(f)}
                  onTogglePublish={() => toggleFamilyPublish(f)}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
              <ul className="divide-y divide-slate-100">
                {filtered.map((f) => (
                  <DesignRow
                    key={f.family}
                    family={f}
                    onSelect={() => setSelectedFamily(f)}
                    onToggleFavorite={() => toggleFavorite(f)}
                    onTogglePublish={() => toggleFamilyPublish(f)}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* SIDEBAR — filters */}
        <aside className="space-y-3 lg:col-span-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Filters</h3>
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setDoorTypeFilter("all");
                  setColorFilter("all");
                }}
                className="text-[10px] font-medium text-indigo-700 hover:underline"
              >
                Clear All
              </button>
            </div>

            <FilterSection label="Door Type">
              <div className="flex flex-wrap gap-1.5">
                <SegBtn
                  label="All"
                  active={doorTypeFilter === "all"}
                  onClick={() => setDoorTypeFilter("all")}
                />
                <SegBtn
                  label="Single Door"
                  active={doorTypeFilter === "SD"}
                  onClick={() => setDoorTypeFilter("SD")}
                />
                <SegBtn
                  label="Double Door"
                  active={doorTypeFilter === "DD"}
                  onClick={() => setDoorTypeFilter("DD")}
                />
              </div>
            </FilterSection>

            <FilterSection label="Color">
              <div className="space-y-1">
                <SegBtn
                  label="All"
                  active={colorFilter === "all"}
                  onClick={() => setColorFilter("all")}
                  full
                />
                {(summary?.availableColors ?? []).map((c) => {
                  const cfg = COLOR_LABEL[c] ?? { label: c, dot: "#cbd5e1" };
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColorFilter(c)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                        colorFilter === c
                          ? "border-indigo-300 bg-indigo-50 text-indigo-800 ring-2 ring-indigo-200"
                          : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200",
                      )}
                    >
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-slate-300"
                        style={{ background: cfg.dot }}
                      />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </FilterSection>

            <div className="border-t border-slate-100 pt-3 text-[10px] text-slate-500">
              Showing <strong>{filtered.length}</strong> of{" "}
              <strong>{families.length}</strong> designs
            </div>
          </div>

          {/* Quick links */}
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              More catalog
            </h3>
            <ul className="space-y-1.5 text-xs">
              <li>
                <Link
                  href="/inventory/available-stock"
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-slate-700 hover:bg-slate-50"
                >
                  Available Stock
                  <ChevronRight size={12} className="text-slate-400" />
                </Link>
              </li>
              <li>
                <Link
                  href="/catalog/dealers/new"
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-slate-700 hover:bg-slate-50"
                >
                  Add a dealer
                  <ChevronRight size={12} className="text-slate-400" />
                </Link>
              </li>
              <li>
                <Link
                  href="/catalog/brands/new"
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-slate-700 hover:bg-slate-50"
                >
                  Add a brand
                  <ChevronRight size={12} className="text-slate-400" />
                </Link>
              </li>
            </ul>
          </div>
        </aside>
      </div>

      {/* Bottom info bar */}
      <div className="flex items-start gap-2 rounded-2xl bg-indigo-50/40 px-4 py-2.5 text-xs text-indigo-900 ring-1 ring-indigo-100">
        <Info size={14} className="mt-0.5 flex-none text-indigo-600" />
        <div>
          Each design is available in{" "}
          {summary?.availableColors?.length ?? 0} colors and{" "}
          {summary?.availableConfigs?.length ?? 0} configurations.
          <br />
          <span className="text-indigo-700/70">
            Colors:{" "}
            {summary?.availableColors
              ?.map((c) => COLOR_LABEL[c]?.label ?? c)
              .join(", ") || "—"}{" "}
            · Configurations:{" "}
            {summary?.availableConfigs
              ?.map((c) => DOOR_TYPE_LABEL[c] ?? c)
              .join(", ") || "—"}
          </span>
        </div>
      </div>

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
    </div>
  );
}

function familyPubState(f: FamilyOut): "all" | "none" | "some" {
  const pub = f.variants.filter((v) => v.published).length;
  if (pub === 0) return "none";
  if (pub === f.variants.length) return "all";
  return "some";
}

/** Web-visibility indicator + toggle (publishes/hides ALL variants of the family). */
function PublishToggle({ family, onToggle }: { family: FamilyOut; onToggle: () => void }) {
  const st = familyPubState(family);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label="Toggle web visibility"
      title={
        st === "all"
          ? "Visible on the web — click to hide"
          : st === "some"
            ? "Partially visible — click to publish all"
            : "Hidden from the web — click to publish"
      }
      className={cn(
        "rounded-full p-1.5 transition",
        st === "all"
          ? "text-emerald-600 hover:bg-emerald-50"
          : st === "some"
            ? "text-amber-600 hover:bg-amber-50"
            : "text-slate-400 hover:bg-slate-100",
      )}
    >
      {st === "none" ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  );
}

function PublishPill({ family }: { family: FamilyOut }) {
  const st = familyPubState(family);
  if (st === "all") return null; // only flag the ones not fully visible
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
        st === "some" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600",
      )}
    >
      {st === "some" ? "Parcial" : "Oculto"}
    </span>
  );
}

function DesignCard({
  family,
  onSelect,
  onToggleFavorite,
  onTogglePublish,
}: {
  family: FamilyOut;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onTogglePublish: () => void;
}) {
  const isCustom = family.family.toUpperCase() === "CUSTOM";
  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl bg-white shadow-sm transition hover:shadow-md",
        isCustom
          ? "ring-2 ring-indigo-400 hover:ring-indigo-500"
          : "ring-1 ring-slate-100 hover:ring-indigo-200",
      )}
    >
      <header
        className={cn(
          "flex items-center justify-between gap-2 border-b px-4 py-2.5",
          isCustom
            ? "border-indigo-100 bg-gradient-to-r from-indigo-50 via-indigo-50 to-violet-50"
            : "border-slate-100 bg-slate-50/60",
        )}
      >
        <div className="flex items-center gap-1.5">
          {isCustom && <Sparkles size={12} className="text-indigo-600" />}
          <h3
            className={cn(
              "font-mono text-sm font-bold",
              isCustom ? "text-indigo-800" : "text-slate-800",
            )}
          >
            {family.family}
          </h3>
        </div>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1",
            isCustom
              ? "bg-white text-indigo-700 ring-indigo-200"
              : "bg-white text-slate-600 ring-slate-200",
          )}
        >
          {isCustom
            ? "Attach your own"
            : `${family.variants.length} config${family.variants.length === 1 ? "" : "s"}`}
        </span>
        <PublishPill family={family} />
        <PublishToggle family={family} onToggle={onTogglePublish} />
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label="Toggle favourite"
          className={cn(
            "rounded-full p-1.5 transition",
            family.favorite
              ? "text-rose-500 hover:bg-rose-50"
              : "text-slate-400 hover:bg-slate-100",
          )}
        >
          <Heart
            size={14}
            fill={family.favorite ? "currentColor" : "none"}
            strokeWidth={2}
          />
        </button>
      </header>
      <div className="grid grid-cols-2 gap-px bg-slate-100">
        {family.variants.slice(0, 2).map((v) => (
          <div
            key={v.id}
            className="relative aspect-[4/5] bg-slate-50"
            title={DOOR_TYPE_LABEL[v.door_type] ?? v.door_type}
          >
            {v.hasImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/api/catalog/designs/${v.id}/image`}
                alt={`${family.family} ${DOOR_TYPE_LABEL[v.door_type] ?? v.door_type}`}
                className="h-full w-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[10px] text-slate-300">
                No image
              </div>
            )}
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-slate-700 shadow ring-1 ring-slate-200">
              {DOOR_TYPE_LABEL[v.door_type] ?? v.door_type}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-2 p-3">
        {family.colors.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Available Colors
            </div>
            <div className="flex flex-wrap gap-1.5">
              {family.colors.map((c) => {
                const cfg = COLOR_LABEL[c] ?? { label: c, dot: "#cbd5e1" };
                return (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200"
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full border border-slate-300"
                      style={{ background: cfg.dot }}
                    />
                    {cfg.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <Link
            href={`/catalog/designs/${family.variants[0]?.id}`}
            className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-700"
          >
            View / Edit
          </Link>
          <button
            type="button"
            onClick={onSelect}
            className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-indigo-700 text-xs font-semibold text-white shadow shadow-indigo-700/20 transition hover:bg-indigo-800"
          >
            Select Design
          </button>
        </div>
      </div>
    </article>
  );
}

function DesignRow({
  family,
  onSelect,
  onToggleFavorite,
  onTogglePublish,
}: {
  family: FamilyOut;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onTogglePublish: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        onClick={onToggleFavorite}
        className={cn(
          "rounded-full p-1.5 transition",
          family.favorite
            ? "text-rose-500 hover:bg-rose-50"
            : "text-slate-400 hover:bg-slate-100",
        )}
        aria-label="Toggle favourite"
      >
        <Heart
          size={14}
          fill={family.favorite ? "currentColor" : "none"}
          strokeWidth={2}
        />
      </button>
      <div className="flex gap-1">
        {family.variants.slice(0, 2).map((v) => (
          <div
            key={v.id}
            className="h-12 w-12 flex-none overflow-hidden rounded-md bg-slate-50 ring-1 ring-slate-200"
            title={DOOR_TYPE_LABEL[v.door_type] ?? v.door_type}
          >
            {v.hasImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/api/catalog/designs/${v.id}/image`}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-mono text-sm font-bold text-slate-800">
          {family.family}
          <PublishPill family={family} />
        </div>
        <div className="flex flex-wrap gap-1 text-[10px] text-slate-500">
          {family.variants.length} configs · {family.colors.length} colors
        </div>
      </div>
      <PublishToggle family={family} onToggle={onTogglePublish} />
      <Link
        href={`/catalog/designs/${family.variants[0]?.id}`}
        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-indigo-300"
      >
        View Details
      </Link>
      <button
        type="button"
        onClick={onSelect}
        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-indigo-700 px-3 text-xs font-semibold text-white shadow shadow-indigo-700/20 transition hover:bg-indigo-800"
      >
        Select Design
      </button>
    </li>
  );
}

function TabChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-semibold transition",
        active
          ? "border-b-2 border-indigo-700 text-indigo-700"
          : "text-slate-500 hover:text-slate-700",
      )}
    >
      {label}
    </button>
  );
}

function FilterSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 space-y-1.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function SegBtn({
  label,
  active,
  onClick,
  full,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1 text-[11px] font-medium transition",
        full && "w-full",
        active
          ? "border-indigo-300 bg-indigo-700 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200",
      )}
    >
      {label}
    </button>
  );
}

function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  iconBg,
  iconColor,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-11 w-11 flex-none items-center justify-center rounded-xl",
            iconBg,
          )}
        >
          <Icon size={18} className={iconColor} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="mt-0.5 text-2xl font-bold leading-tight text-slate-900">
            {value}
          </div>
          <div className="truncate text-[10px] text-slate-400">{hint}</div>
        </div>
      </div>
    </div>
  );
}

interface PrintMenuItemProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}

function PrintMenuItem({
  icon: Icon,
  title,
  subtitle,
  onClick,
  disabled,
}: PrintMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800">{title}</span>
        <span className="block text-xs text-slate-500">{subtitle}</span>
      </span>
    </button>
  );
}
