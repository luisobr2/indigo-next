"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Clock,
  CornerDownLeft,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";
import {
  SCOPES,
  countByKind,
  doorTypeLabel,
  hitsToItems,
  isPaletteShortcut,
  matchPages,
  money,
  nextScope,
  pushRecent,
  type PaletteItem,
  type SearchHits,
} from "@/lib/command-search";
import type { NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<PaletteItem["kind"], LucideIcon | null> = {
  page: null,
  action: Plus,
  order: ListChecks,
  invoice: FileText,
  dealer: Building2,
  design: Shapes,
};

const KIND_LABEL: Record<PaletteItem["kind"], string> = {
  page: "Pages",
  action: "Actions",
  order: "Orders",
  invoice: "Invoices",
  dealer: "Dealers",
  design: "Designs",
};

/** Pages offered with nothing typed, in this order, if the person can see them. */
const GO_TO = ["/orders", "/kanban", "/installations", "/calendar", "/billing", "/catalog"];

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
 * address, phone in any format), invoices, dealers, catalog designs and menu
 * pages, with a preview of the highlighted one on the right.
 *
 * Keys: ↑↓ move · Tab / Shift+Tab switch tab · Enter open · Ctrl/⌘+Enter (or
 * Ctrl/middle click) new tab · Esc close.
 */
export function CommandPalette({ pages }: { pages: NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<string>("all");
  // The highlighted row is remembered by key, not position: when results
  // arrive while you type, the row you were on stays highlighted.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [recent, setRecent] = useState<PaletteItem[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // With nothing typed: recent places, then shortcuts to the main screens.
  const homeItems = useMemo(() => {
    const goTo: PaletteItem[] = GO_TO.map((href) => pages.find((p) => p.href === href))
      .filter((p): p is NavItem => !!p)
      .map((p) => ({ kind: "page", key: `go:${p.href}`, title: p.label, subtitle: "Go to", href: p.href }));
    const actions: PaletteItem[] = pages.some((p) => p.href === "/billing")
      ? [{ kind: "action", key: "action:new-invoice", title: "New invoice", subtitle: "Billing", href: "/billing/invoices/new" }]
      : [];
    return { recent, rest: [...actions, ...goTo] };
  }, [pages, recent]);

  const results = useMemo(() => {
    if (!typed) return [];
    const pageItems = matchPages(pages, typed);
    const hitItems = q.length >= 2 && data ? hitsToItems(data) : [];
    return [...hitItems, ...pageItems];
  }, [pages, typed, q, data]);

  const counts = useMemo(() => countByKind(results), [results]);
  const activeScope = scope !== "all" && !counts[scope] ? "all" : scope;
  const items = typed
    ? activeScope === "all" ? results : results.filter((i) => i.kind === activeScope)
    : [...homeItems.recent, ...homeItems.rest];

  const activeIndex = Math.max(0, items.findIndex((i) => i.key === activeKey));
  const active = items[activeIndex];

  function close() {
    setOpen(false);
    setInput("");
    setQ("");
    setScope("all");
    setActiveKey(null);
  }

  function remember(item: PaletteItem) {
    if (item.kind === "action") return;
    writeRecent(pushRecent(readRecent(), { ...item, detail: undefined }));
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
    } else if (e.key === "Tab" && typed) {
      e.preventDefault();
      setScope(nextScope(activeScope, counts, e.shiftKey));
      setActiveKey(null);
    }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const shortcut = isMac ? "⌘K" : "Ctrl K";
  const newTabKey = isMac ? "⌘ Enter" : "Ctrl Enter";
  const waiting = typed.length >= 2 && (isFetching || typed !== q);

  let emptyText: string | null = null;
  if (typed && !items.length) {
    if (typed.length < 2) emptyText = "Keep typing…";
    else if (isError) emptyText = "The search didn't go through. Check your connection and try again.";
    else if (waiting) emptyText = "Searching…";
    else emptyText = `Nothing found for “${typed}”.`;
  }

  function fill(text: string) {
    setInput(text);
    setActiveKey(null);
    inputRef.current?.focus();
  }

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        aria-label="Search"
        className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-500 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:w-80 sm:px-3"
      >
        <Search size={16} className="flex-none text-slate-400" />
        <span className="hidden flex-1 truncate text-left sm:inline">Search orders, invoices, pages…</span>
        <kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px] text-slate-500 sm:inline">
          {shortcut}
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={(v) => (v ? openPalette() : close())}>
        <DialogContent
          showCloseButton={false}
          className="top-[6%] translate-y-0 gap-0 overflow-hidden border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl sm:max-w-4xl"
        >
          <DialogTitle className="sr-only">Search</DialogTitle>

          {/* Search box */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-5">
            <Search size={20} className="flex-none text-slate-400" />
            <input
              ref={inputRef}
              id="command-search"
              autoFocus
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setActiveKey(null);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search orders, clients, invoices, dealers, designs…"
              className="h-14 min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls="command-results"
              aria-activedescendant={active ? `cmd-${active.key}` : undefined}
            />
            {waiting && <Loader2 size={18} className="flex-none animate-spin text-slate-400" />}
            <kbd className="hidden flex-none rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px] text-slate-500 sm:inline">
              Esc
            </kbd>
          </div>

          {/* Tabs */}
          {typed && (
            <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3" role="tablist" aria-label="Filter results">
              {SCOPES.filter((sc) => sc.key === "all" || counts[sc.key]).map((sc) => (
                <button
                  key={sc.key}
                  type="button"
                  role="tab"
                  aria-selected={activeScope === sc.key}
                  onClick={() => {
                    setScope(sc.key);
                    setActiveKey(null);
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    "flex flex-none items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
                    activeScope === sc.key ? "border-indigo-700 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800",
                  )}
                >
                  {sc.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[11px] tabular-nums",
                      activeScope === sc.key ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500",
                    )}
                  >
                    {counts[sc.key] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Results + preview */}
          <div className="grid h-[min(560px,68vh)] grid-cols-1 md:grid-cols-[minmax(0,1fr)_320px]">
            <div ref={listRef} id="command-results" role="listbox" className="overflow-y-auto p-2">
              {emptyText ? (
                <p className={cn("px-3 py-10 text-center text-sm", isError ? "text-rose-600" : "text-slate-500")}>{emptyText}</p>
              ) : (
                items.map((item, idx) => {
                  const prev = items[idx - 1];
                  let group: string | null = null;
                  if (!typed) {
                    const inRecent = idx < homeItems.recent.length;
                    const prevInRecent = idx - 1 < homeItems.recent.length;
                    if (idx === 0) group = inRecent ? "Recent" : "Quick access";
                    else if (!inRecent && prevInRecent) group = "Quick access";
                  } else if (idx === 0 || prev.kind !== item.kind) {
                    group = KIND_LABEL[item.kind];
                  }
                  const PageIcon = item.kind === "page" ? pages.find((p) => p.href === item.href)?.icon : null;
                  const Icon = KIND_ICON[item.kind] ?? PageIcon ?? Search;
                  const isActive = idx === activeIndex;
                  return (
                    <div key={item.key}>
                      {group && (
                        <div className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 first:pt-1">
                          {group === "Recent" && <Clock size={11} />}
                          {group}
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
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm",
                          isActive ? "bg-indigo-50 text-indigo-900" : "text-slate-700",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 flex-none items-center justify-center rounded-lg",
                            isActive ? "bg-white text-indigo-700" : "bg-slate-100 text-slate-500",
                          )}
                        >
                          <Icon size={16} />
                        </span>
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

            <aside className="hidden min-h-0 overflow-y-auto border-l border-slate-100 bg-slate-50 md:block">
              {typed && active ? (
                <Preview item={active} newTabKey={newTabKey} onOpen={(nt) => go(active, nt)} />
              ) : (
                <Tips onExample={fill} />
              )}
            </aside>
          </div>

          {/* Keys */}
          <div className="flex items-center gap-x-4 overflow-x-auto whitespace-nowrap border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-500">
            <span><Key>↑↓</Key> move</span>
            <span><Key>Enter</Key> open</span>
            <span className="hidden sm:inline"><Key>{newTabKey}</Key> new tab</span>
            {typed && <span className="hidden sm:inline"><Key>Tab</Key> next tab</span>}
            <span><Key>Esc</Key> close</span>
            <span className="ml-auto hidden sm:inline"><Key>{shortcut}</Key> from any screen</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mr-1 rounded border border-slate-200 bg-white px-1 py-px font-sans text-[10px] text-slate-600">{children}</kbd>
  );
}

/** The right pane with nothing typed: what you can search for, as examples to click. */
function Tips({ onExample }: { onExample: (text: string) => void }) {
  const examples: Array<{ label: string; sample: string }> = [
    { label: "An order number", sample: "544" },
    { label: "A client's name", sample: "Smith" },
    { label: "A Customer PO", sample: "123456" },
    { label: "Phone, any format or the last 4", sample: "0142" },
    { label: "Part of the address", sample: "NW 26th" },
    { label: "A design code", sample: "ID70" },
  ];
  return (
    <div className="space-y-4 p-5">
      <div>
        <p className="text-sm font-semibold text-slate-800">You can search by</p>
        <p className="mt-1 text-xs text-slate-500">Click an example to try it.</p>
      </div>
      <ul className="space-y-2">
        {examples.map((ex) => (
          <li key={ex.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-600">{ex.label}</span>
            <button
              type="button"
              onClick={() => onExample(ex.sample)}
              className="flex-none rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
            >
              {ex.sample}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-slate-500">
        Invoices and dealers show up for the office. Everyone sees the orders they can open.
      </p>
    </div>
  );
}

function Field({ icon: Icon, label, value }: { icon?: LucideIcon; label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      {Icon ? <Icon size={14} className="mt-0.5 flex-none text-slate-400" /> : null}
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
        <div className="break-words text-slate-800">{value}</div>
      </div>
    </div>
  );
}

/** Shown only once it has loaded: a design without a photo leaves no empty frame. */
function PreviewImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onLoad={(e) => setLoaded(e.currentTarget.naturalWidth > 1)}
      className={cn("h-36 w-full rounded-lg border border-slate-200 bg-white object-contain", !loaded && "hidden")}
    />
  );
}

const COLOR_LABEL: Record<string, string> = { white: "White", black: "Black", bronze: "Bronze", bronze_eco: "Bronze (eco)", custom: "Custom" };

/** The right pane for the highlighted row: enough to know it's the right one before opening it. */
function Preview({ item, onOpen, newTabKey }: { item: PaletteItem; onOpen: (newTab: boolean) => void; newTabKey: string }) {
  const d = item.detail;
  const firstDesign = d?.kind === "order" ? d.doors.find((x) => x.design_id) : undefined;
  const imageUrl =
    d?.kind === "design"
      ? d.imageUrl
      : firstDesign
        ? `/api/catalog/designs/${firstDesign.design_id}/image?type=${firstDesign.door_type || ""}&color=${firstDesign.color || ""}`
        : null;
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{KIND_LABEL[item.kind].replace(/s$/, "")}</p>
        <p className="mt-0.5 break-words text-base font-semibold text-slate-900">{item.title}</p>
        {d?.kind === "order" && d.stage && (
          <span className="mt-2 inline-block rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{d.stage}</span>
        )}
        {d?.kind === "invoice" && (
          <span
            className={cn(
              "mt-2 inline-block rounded-md px-2 py-0.5 text-xs font-medium",
              d.status === "Paid" ? "bg-emerald-50 text-emerald-700" : d.status === "Draft" ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-700",
            )}
          >
            {d.status}
          </span>
        )}
      </div>

      {imageUrl && <PreviewImage key={imageUrl} src={imageUrl} />}

      <div className="space-y-3">
        {d?.kind === "order" && (
          <>
            <Field label="Client" value={d.client} />
            <Field icon={Building2} label="Dealer" value={d.dealer} />
            <Field label="Customer PO" value={d.po} />
            <Field icon={Phone} label="Phone" value={d.phone} />
            <Field icon={MapPin} label="Address" value={d.address} />
            <Field label="Installation" value={d.installDate} />
            {d.doors.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">
                  {d.doors.length === 1 ? "Door" : `${d.doors.length} doors`}
                </div>
                <ul className="mt-1 space-y-1 text-sm text-slate-800">
                  {d.doors.slice(0, 4).map((x, i) => (
                    <li key={i} className="truncate">
                      {[x.design || "No design", doorTypeLabel(x.door_type), x.color ? COLOR_LABEL[x.color] ?? x.color : ""]
                        .filter(Boolean)
                        .join(" · ")}
                      {x.qty > 1 ? ` ×${x.qty}` : ""}
                    </li>
                  ))}
                  {d.doors.length > 4 && <li className="text-xs text-slate-500">+{d.doors.length - 4} more</li>}
                </ul>
              </div>
            )}
          </>
        )}
        {d?.kind === "invoice" && (
          <>
            <Field icon={Building2} label="Dealer" value={d.dealer} />
            <Field label="Total" value={money.format(d.amount)} />
            {d.status !== "Paid" && d.status !== "Draft" && <Field label="Still to collect" value={money.format(d.due)} />}
            <Field label="Date" value={d.date} />
            <Field label="Clients" value={d.clients} />
          </>
        )}
        {d?.kind === "dealer" && (
          <>
            <Field icon={Phone} label="Phone" value={d.phone} />
            <Field icon={Mail} label="Email" value={d.email} />
            <Field icon={MapPin} label="City" value={d.city} />
          </>
        )}
        {d?.kind === "design" && (
          <>
            <Field label="Code" value={d.code} />
            <Field label="Name" value={d.name} />
            <Field label="Type" value={d.doorType} />
          </>
        )}
        {!d && <p className="text-sm text-slate-500">{item.subtitle || "Open this page."}</p>}
      </div>

      <div className="mt-auto flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => onOpen(false)}
          // Literal colors: in dark mode indigo-700 turns light and "white" becomes the card blue.
          className="flex-1 rounded-lg bg-[#1f4486] px-3 py-2 text-sm font-medium text-[#ffffff] transition hover:bg-[#1a376e]"
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => onOpen(true)}
          title={`Open in a new tab (${newTabKey})`}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
        >
          <ExternalLink size={14} /> New tab
        </button>
      </div>
    </div>
  );
}
