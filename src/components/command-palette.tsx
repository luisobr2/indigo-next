"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, Clock, CornerDownLeft, FileText, ListChecks, Loader2, Search, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";
import {
  hitsToItems,
  isPaletteShortcut,
  matchPages,
  pushRecent,
  type PaletteItem,
  type SearchHits,
} from "@/lib/command-search";
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

const RECENT_KEY = "indigo:search-recent";

function readRecent(): PaletteItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.href === "string" && typeof r.key === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(items: PaletteItem[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items));
  } catch {
    /* private window / storage blocked: recents are a convenience */
  }
}

/**
 * Ctrl+K / ⌘K search, opened from anywhere in the staff panel or from the
 * search bar in the header. Finds orders (number, client, PO, reference,
 * address, phone in any format), invoices, dealers and menu pages.
 * Arrows move, Enter opens, Ctrl/⌘+Enter (or Ctrl/middle click) opens in a new
 * tab, Esc closes. With nothing typed it shows the places opened last.
 */
export function CommandPalette({ pages }: { pages: NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  // The highlighted row is remembered by key, not position: when results
  // arrive while you type, the row you were on stays highlighted.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [recent, setRecent] = useState<PaletteItem[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // Server render says "Ctrl K"; the browser corrects it on a Mac without a
  // hydration mismatch.
  const isMac = useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );

  function openPalette() {
    setRecent(readRecent());
    setOpen(true);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isPaletteShortcut(e)) {
        e.preventDefault();
        setRecent(readRecent());
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

  const { data, isFetching, isError } = useQuery<SearchHits>({
    queryKey: ["command-search", q],
    queryFn: () => fetchJson<SearchHits>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: open && q.length >= 2,
    staleTime: 15_000,
    retry: 1,
  });

  const typed = input.trim();
  const items = useMemo(() => {
    if (!typed) return recent;
    const pageItems = matchPages(pages, typed);
    const hitItems = q.length >= 2 && data ? hitsToItems(data) : [];
    return [...hitItems, ...pageItems];
  }, [pages, typed, q, data, recent]);

  const activeIndex = Math.max(0, items.findIndex((i) => i.key === activeKey));
  const active = items[activeIndex];

  function close() {
    setOpen(false);
    setInput("");
    setQ("");
    setActiveKey(null);
  }

  function remember(item: PaletteItem) {
    const next = pushRecent(readRecent(), item);
    writeRecent(next);
  }

  function go(item: PaletteItem | undefined, newTab = false) {
    if (!item) return;
    remember(item);
    if (newTab) {
      window.open(item.href, "_blank", "noopener");
      return;
    }
    close();
    router.push(item.href);
  }

  function move(delta: number) {
    if (!items.length) return;
    const next = Math.min(Math.max(activeIndex + delta, 0), items.length - 1);
    setActiveKey(items[next].key);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(active, e.ctrlKey || e.metaKey);
    }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const shortcut = isMac ? "⌘K" : "Ctrl K";
  const newTabKey = isMac ? "⌘ Enter" : "Ctrl Enter";
  const waiting = typed.length >= 2 && (isFetching || typed !== q);

  let empty: string | null = null;
  if (!items.length) {
    if (!typed) empty = "Type an order number, a client, a PO, an address, a phone, an invoice or a page.";
    else if (typed.length < 2) empty = "Keep typing…";
    else if (isError) empty = "The search didn't go through. Check your connection and try again.";
    else if (waiting) empty = "Searching…";
    else empty = `Nothing found for “${typed}”.`;
  }

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        aria-label="Search"
        className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-500 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:w-72 sm:px-3"
      >
        <Search size={16} className="flex-none text-slate-400" />
        <span className="hidden flex-1 truncate text-left sm:inline">Search orders, invoices, pages…</span>
        <kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px] text-slate-500 sm:inline">
          {shortcut}
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={(v) => (v ? openPalette() : close())}>
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
                setActiveKey(null);
              }}
              onKeyDown={onKeyDown}
              placeholder="Order, client, PO, address, phone, invoice, dealer or page…"
              className="h-12 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls="command-results"
              aria-activedescendant={active ? `cmd-${active.key}` : undefined}
            />
            {waiting && <Loader2 size={16} className="flex-none animate-spin text-slate-400" />}
          </div>

          <div ref={listRef} id="command-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
            {empty ? (
              <p className={cn("px-3 py-6 text-center text-sm", isError && typed ? "text-rose-600" : "text-slate-500")}>
                {empty}
              </p>
            ) : (
              items.map((item, idx) => {
                const showGroup = idx === 0 || (typed && items[idx - 1].kind !== item.kind);
                const PageIcon = item.kind === "page" ? pages.find((p) => p.href === item.href)?.icon : null;
                const Icon = KIND_ICON[item.kind] ?? PageIcon ?? Search;
                const isActive = idx === activeIndex;
                return (
                  <div key={item.key}>
                    {showGroup && (
                      <div className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 first:pt-1">
                        {!typed && <Clock size={11} />}
                        {typed ? KIND_LABEL[item.kind] : "Recent"}
                      </div>
                    )}
                    <Link
                      href={item.href}
                      id={`cmd-${item.key}`}
                      role="option"
                      aria-selected={isActive}
                      data-index={idx}
                      onMouseMove={() => setActiveKey(item.key)}
                      onClick={(e) => {
                        // Ctrl/⌘/middle click: let the browser open a new tab.
                        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) {
                          remember(item);
                          return;
                        }
                        e.preventDefault();
                        go(item);
                      }}
                      onAuxClick={() => remember(item)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm",
                        isActive ? "bg-indigo-50 text-indigo-900" : "text-slate-700",
                      )}
                    >
                      <Icon size={16} className={cn("flex-none", isActive ? "text-indigo-700" : "text-slate-400")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.title}</span>
                        {item.subtitle && <span className="block truncate text-xs text-slate-500">{item.subtitle}</span>}
                      </span>
                      {isActive && <CornerDownLeft size={14} className="flex-none text-indigo-700" />}
                    </Link>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
            <span><kbd className="font-sans">↑↓</kbd> move</span>
            <span><kbd className="font-sans">Enter</kbd> open</span>
            <span className="hidden sm:inline"><kbd className="font-sans">{newTabKey}</kbd> new tab</span>
            <span><kbd className="font-sans">Esc</kbd> close</span>
            <span className="ml-auto hidden sm:inline">{shortcut} anywhere</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
