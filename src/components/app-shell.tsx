"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LogOut,
  ChevronDown,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  EyeOff,
  UserCog,
  Building2,
  Pencil,
  Brush,
  Hammer,
  Truck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, type NavItem } from "@/lib/nav";
import { deriveRole } from "@/lib/odoo/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { NotificationsBell } from "@/components/notifications-bell";

interface MeResponse {
  user: {
    id: number;
    login: string;
    name: string;
    isAdmin: boolean;
    groups: string[];
  } | null;
  role?: ReturnType<typeof deriveRole>;
  impersonating?: {
    original: { id: number; name: string; login: string };
  } | null;
}

/** Targets the manager can impersonate. Must match server allow-list. */
const IMPERSONATE_TARGETS = [
  { role: "Office", login: "oficina@indigodecors.com", name: "Beatriz", icon: Building2 },
  { role: "Designer", login: "disenador@indigodecors.com", name: "Pedro", icon: Pencil },
  { role: "Painter", login: "pintor@indigodecors.com", name: "Mario", icon: Brush },
  { role: "CNC", login: "cnc@indigodecors.com", name: "Ramon", icon: Hammer },
  { role: "Installer", login: "instalador@indigodecors.com", name: "Carlos", icon: Truck },
] as const;

const COLLAPSE_KEY = "indigo:sidebar-collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Restore collapsed state from localStorage on mount so the layout
  // doesn't flash open before reading the user's preference.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(COLLAPSE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Auto-close the mobile drawer on route change so users don't see it
  // stick open after navigating from inside the panel.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const qc = useQueryClient();
  const { data } = useQuery<MeResponse>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then((r) => r.json()),
  });

  const user = data?.user;
  const role = data?.role;
  const impersonating = data?.impersonating ?? null;
  // "View as" entry point is gated behind Manager / admin. When the
  // original session belongs to a manager but the active session is
  // impersonated, we still expose Exit but hide the picker (you can't
  // nest).
  const canImpersonate =
    !!user && (role?.isManager || user.isAdmin) && !impersonating;

  const items = role
    ? NAV_ITEMS.filter((it) => !it.show || it.show(role))
    : NAV_ITEMS;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  async function startImpersonation(target: (typeof IMPERSONATE_TARGETS)[number]) {
    const promise = fetch("/api/auth/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: target.login }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed");
        await qc.invalidateQueries({ queryKey: ["me"] });
        router.replace(j.landing || "/dashboard");
        return j;
      });
    toast.promise(promise, {
      loading: `Switching to ${target.name}...`,
      success: `Now viewing as ${target.name}`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  async function exitImpersonation() {
    const promise = fetch("/api/auth/impersonate", { method: "DELETE" }).then(
      async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed");
        await qc.invalidateQueries({ queryKey: ["me"] });
        router.replace("/dashboard");
        return j;
      },
    );
    toast.promise(promise, {
      loading: "Restoring session...",
      success: (j) => `Back as ${j.user.name}`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  /**
   * Inner nav body — re-used by desktop aside + mobile drawer.
   * `isCollapsed` only applies to desktop; the mobile drawer is always full.
   */
  function NavBody({ isCollapsed }: { isCollapsed: boolean }) {
    return (
      <>
        {/* ---------- Logo ---------- */}
        <div
          className={cn(
            "flex items-center border-b border-slate-100 py-4",
            isCollapsed ? "justify-center px-3" : "gap-3 px-5",
          )}
        >
          <Link
            href="/dashboard"
            className={cn(
              "relative flex shrink-0 items-center justify-center",
              isCollapsed ? "h-10 w-10" : "h-12 w-12",
            )}
            aria-label="Indigo Decors home"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/indigo-logo.webp"
              alt="Indigo Decors"
              className="h-full w-full object-contain"
            />
          </Link>
          {!isCollapsed && (
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-sm font-bold tracking-tight text-indigo-900">
                INDIGO DECORS
              </span>
              <span className="mt-0.5 text-[10px] uppercase tracking-widest text-slate-400">
                Production ERP
              </span>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
            className="ml-auto md:hidden"
          >
            <X size={18} />
          </Button>
        </div>

        {/* ---------- Nav links ---------- */}
        <nav className="flex-1 overflow-y-auto py-3 scrollbar-thin">
          {items.map((item: NavItem, idx: number) => {
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            const Icon = item.icon;
            const showHeader =
              !isCollapsed && item.section && item.section !== items[idx - 1]?.section;
            return (
              <div key={item.href}>
                {showHeader && (
                  <div className="mx-3 mb-1 mt-3 border-t border-slate-100 px-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {item.section}
                  </div>
                )}
              <Link
                href={item.href}
                title={isCollapsed ? item.label : undefined}
                className={cn(
                  "mx-2 flex items-center rounded-xl text-sm font-medium transition",
                  isCollapsed
                    ? "justify-center px-2 py-2.5"
                    : "gap-3 px-3 py-2.5",
                  active
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-800 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                <Icon
                  size={18}
                  className={cn(
                    "shrink-0",
                    active ? "text-indigo-700" : "text-slate-600",
                  )}
                />
                {!isCollapsed && <span>{item.label}</span>}
              </Link>
              </div>
            );
          })}
        </nav>

        {/* ---------- Footer: collapse toggle ---------- */}
        <div className="border-t border-slate-100 p-3">
          {/* Collapse toggle — desktop only */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleCollapsed}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "hidden w-full md:flex",
              isCollapsed && "justify-center",
            )}
          >
            {isCollapsed ? (
              <ChevronsRight size={14} className="text-slate-500" />
            ) : (
              <>
                <ChevronsLeft size={14} className="text-slate-500" />
                <span>Collapse</span>
              </>
            )}
          </Button>
        </div>
      </>
    );
  }

  return (
    // h-screen + overflow-hidden anchors the shell to the viewport so the
    // sidebar/topbar never scroll out of view. Each region manages its own
    // overflow internally (sidebar nav + main content).
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden h-full shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 md:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <NavBody isCollapsed={collapsed} />
      </aside>

      {/* Mobile drawer — overlays the page when the hamburger is tapped. */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 flex md:hidden"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu overlay"
            className="absolute inset-0 bg-slate-900/40"
          />
          <aside className="relative flex w-64 max-w-[80%] flex-col bg-white shadow-2xl">
            <NavBody isCollapsed={false} />
          </aside>
        </div>
      )}

      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-100 bg-white px-4 sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="md:hidden"
          >
            <Menu size={20} />
          </Button>
          <div className="ml-auto flex items-center gap-3">
            {canImpersonate && (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:px-3">
                  <Eye size={14} className="text-indigo-700" />
                  <span className="hidden sm:inline">View as</span>
                  <ChevronDown size={12} className="text-slate-400" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Impersonate
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  {IMPERSONATE_TARGETS.map((t) => {
                    const Icon = t.icon;
                    return (
                      <DropdownMenuItem
                        key={t.login}
                        onClick={() => startImpersonation(t)}
                      >
                        <Icon size={14} className="text-slate-500" />
                        <div className="flex min-w-0 flex-col">
                          <span className="font-semibold text-slate-800">
                            {t.name}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {t.role}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <NotificationsBell />
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex items-center gap-2 rounded-xl border border-slate-200 px-2 py-1.5 text-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:px-3"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-indigo-700 text-[10px] font-bold text-white">
                    {user?.name?.[0] ?? "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden flex-col items-start leading-tight sm:flex">
                  <span className="font-semibold text-slate-800">
                    {user?.name ?? "..."}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {role?.isManager
                      ? "Administrator"
                      : role?.isOffice
                        ? "Office"
                        : role?.isDesigner
                          ? "Designer"
                          : role?.isPainter
                            ? "Painter"
                            : role?.isCnc
                              ? "CNC"
                              : role?.isInstaller
                                ? "Installer"
                                : ""}
                  </span>
                </div>
                <ChevronDown size={14} className="text-slate-400" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {user && (
                  <>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="flex flex-col gap-0.5">
                        <span className="font-semibold text-slate-800">{user.name}</span>
                        <span className="text-[10px] font-normal text-slate-500">{user.login}</span>
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onClick={logout}
                  className="text-rose-600 focus:bg-rose-50 focus:text-rose-700"
                >
                  <LogOut size={14} />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {impersonating && (
          <div className="flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs sm:px-6">
            <UserCog size={14} className="shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1 truncate text-amber-900">
              Viewing as{" "}
              <strong className="font-bold">{user?.name ?? ""}</strong>
              <span className="ml-1.5 hidden text-amber-700/80 sm:inline">
                · original session: {impersonating.original.name} ({impersonating.original.login})
              </span>
            </div>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={exitImpersonation}
              className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
            >
              <EyeOff size={12} />
              Exit
            </Button>
          </div>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5">
          {children}
        </main>
      </div>
    </div>
  );
}
