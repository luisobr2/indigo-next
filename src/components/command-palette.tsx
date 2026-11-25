"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, FileText, Loader2, Search, ListChecks, CornerDownLeft, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";
import { hitsToItems, isPaletteShortcut, matchPages, type PaletteItem, type SearchHits } from "@/lib/command-search";
import type { NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<PaletteItem["kind"], LucideIcon | null> = {
  page: null,
  order: ListChecks,
  invoice: FileText,
  dealer: Building2,
};

const KIND_LABEL: Record<PaletteItem["kind"], string> = {
  page: "Pages",
  order: "Orders",
  invoice: "Invoices",
  dealer: "Dealers",
};

/**
 * Ctrl+K / ⌘K search, opened from anywhere in the staff panel or from the
 * search bar in the header. Finds orders, invoices, dealers and menu pages;
 * arrows move, Enter opens, Esc closes.
 */
export function CommandPalette({ pages }: { pages: NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Server render says "Ctrl K"; the browser corrects it on a Mac without a
  // hydration mismatch.
  const isMac = useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isPaletteShortcut(e)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 200);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isFetching } = useQuery<SearchHits>({
    queryKey: ["command-search", q],
    queryFn: () => fetchJson<SearchHits>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: open && q.length >= 2,
    staleTime: 15_000,
  });

  const items = useMemo(() => {
    const pageItems = matchPages(pages, input);
    const hitItems = q.length >= 2 && data ? hitsToItems(data) : [];
    return [...hitItems, ...pageItems];
  }, [pages, input, q, data]);

  const activeIndex = items.length ? Math.min(active, items.length - 1) : 0;

  function close() {
    setOpen(false);
    setInput("");
    setQ("");
    setActive(0);
  }

  function go(item: PaletteItem | undefined) {
    if (!item) return;
    close();
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[activeIndex]);
    }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const shortcut = isMac ? "⌘K" : "Ctrl K";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-500 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:w-72 sm:px-3"
      >
        <Search size={16} className="flex-none text-slate-400" />
        <span className="hidden flex-1 truncate text-left sm:inline">Search orders, invoices, pages…</span>
        <kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px] text-slate-500 sm:inline">
          {shortcut}
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
        <DialogContent showCloseButton={false} className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="flex items-center gap-2 border-b border-slate-100 px-4">
            <Search size={18} className="flex-none text-slate-400" />
            <input
              id="command-search"
              autoFocus
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Order number, client, PO, invoice, dealer or page…"
              className="h-12 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls="command-results"
              aria-activedescendant={items[activeIndex] ? `cmd-${items[activeIndex].key}` : undefined}
            />
            {isFetching && <Loader2 size={16} className="flex-none animate-spin text-slate-400" />}
          </div>

          <div ref={listRef} id="command-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
            {!input.trim() ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">
                Type an order number, a client, a PO, an invoice or a page name.
              </p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">
                {isFetching || input.trim() !== q ? "Searching…" : `Nothing found for “${input.trim()}”.`}
              </p>
            ) : (
              items.map((item, idx) => {
                const showGroup = idx === 0 || items[idx - 1].kind !== item.kind;
                const PageIcon = item.kind === "page" ? pages.find((p) => p.href === item.href)?.icon : null;
                const Icon = KIND_ICON[item.kind] ?? PageIcon ?? Search;
                return (
                  <div key={item.key}>
                    {showGroup && (
                      <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 first:pt-1">
                        {KIND_LABEL[item.kind]}
                      </div>
                    )}
                    <button
                      type="button"
                      id={`cmd-${item.key}`}
                      role="option"
                      aria-selected={idx === activeIndex}
                      data-index={idx}
                      onMouseMove={() => setActive(idx)}
                      onClick={() => go(item)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm",
                        idx === activeIndex ? "bg-indigo-50 text-indigo-900" : "text-slate-700",
                      )}
                    >
                      <Icon size={16} className={cn("flex-none", idx === activeIndex ? "text-indigo-700" : "text-slate-400")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.title}</span>
                        {item.subtitle && <span className="block truncate text-xs text-slate-500">{item.subtitle}</span>}
                      </span>
                      {idx === activeIndex && <CornerDownLeft size={14} className="flex-none text-indigo-700" />}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center gap-4 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
            <span><kbd className="font-sans">↑↓</kbd> to move</span>
            <span><kbd className="font-sans">Enter</kbd> to open</span>
            <span><kbd className="font-sans">Esc</kbd> to close</span>
            <span className="ml-auto">{shortcut} anywhere</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
