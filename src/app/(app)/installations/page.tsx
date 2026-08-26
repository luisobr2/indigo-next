"use client";

import { useMemo, useState, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Columns3,
  Download,
  FolderOpen,
  HelpCircle,
  Info,
  MapPin,
  Pause,
  PieChart as PieIcon,
  Play,
  Plus,
  Printer,
  Search,
  UserRound,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, fmtNum, fmtDate, cn } from "@/lib/utils";
import { toCsv, downloadCsv } from "@/lib/csv";
import { fetchJson } from "@/lib/fetch-json";
import { holdCounterLabel } from "@/lib/installations/hold-groups";
import { ErrorState } from "@/components/state-cards";
import { AddInstallerModal } from "@/components/add-installer-modal";
import { HoldModal } from "@/components/hold-modal";
import {
  ScheduleInstallationModal,
  type ScheduleTarget,
} from "@/components/schedule-installation-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MobileCardList, MobileRowCard } from "@/components/mobile-row-card";
import { BulkSendToButton } from "@/components/bulk-send-to-button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { TableRowsSkeleton } from "@/components/skeleton";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  PieChart as RPieChart,
  Pie,
} from "recharts";

/** Geo de planificacion que Odoo calcula desde el ZIP (pedido #4 de Majela).
 *  `distance_mi` es una estimacion por carretera; `geo_approx` avisa cuando
 *  el ZIP exacto no estaba y se resolvio por el prefijo del condado. */
interface RowGeo {
  distance_mi: number | null;
  corridor: string | null;
  range_id: number | null;
  range_name: string | null;
  geo_approx: boolean;
}

interface DashboardData {
  rangeStart: string;
  rangeEnd: string;
  truncated?: boolean;
  totalInRange?: number;
  payRules: Array<{
    partnerId: number | null;
    ratePerDoor: number;
    dailyMinimum: number;
    bonusAmount: number;
    bonusUnit: "order" | "door";
  }>;
  summary: {
    totalInstallers: number;
    doorsToInstall: number;
    installedThisWeek: number;
    pendingThisWeek: number;
    scheduled: number;
    paymentDue: number;
    paymentForecast: number;
  };
  installers: Array<{
    id: number;
    name: string;
    doors: number;
    installed: number;
    pending: number;
    paymentDue: number;
    orders: Array<{
      id: number;
      name: string;
      dealer_ref: string;
      client_name: string;
      client_address: string;
      door_type: string;
      color: string;
      qty: number;
      status: "installed" | "scheduled" | "pending";
      stage_code: string;
      scheduled_date: string | false;
    }>;
  }>;
  unscheduled: Array<{
    id: number;
    name: string;
    dealer_ref: string;
    client_name: string;
    client_phone: string | false;
    client_address: string;
    door_type: string;
    color: string;
    qty: number;
    stage_code: string;
    installer: string;
    installer_ids: number[];
    geo?: RowGeo;
  }>;
  overdue: Array<{
    id: number;
    name: string;
    dealer_ref: string;
    client_name: string;
    client_address: string;
    door_type: string;
    qty: number;
    scheduled_date: string;
    days_overdue: number;
    installer: string;
    installer_ids: number[];
    geo?: RowGeo;
  }>;
  // Majela's 2026-08-15 request (item 3): tell a door blocked by the
  // DEALER apart from one blocked by the CLIENT, with a count per cause —
  // NOT folded into overdue/unscheduled, which is exactly what she said
  // she didn't want ("no que sea overdue y pending schedule").
  onHold: Record<
    "dealer" | "client" | "other",
    {
      doorCount: number;
      orders: Array<{
        id: number;
        name: string;
        dealer_ref: string;
        client_name: string;
        client_address: string;
        door_type: string;
        color: string;
        door_count: number;
        stage_code: string;
        hold_cause: "dealer" | "client" | "other";
        hold_reason: string;
        installer: string;
        geo?: RowGeo;
      }>;
    }
  >;
  zones: Array<{
    id: number;
    name: string;
    short_name: string;
    min_miles: number;
    max_miles: number;
    color: string;
    doors: number;
    orders: number;
    /** Desglose por lado dentro del rango. Cada entrada es una tanda armable:
     *  "35 millas al norte" y "35 millas al sur" son el mismo rango pero
     *  dias distintos. */
    directions: Array<{ code: string; doors: number; orders: number }>;
  }>;
  zonesUnlocated: { doors: number; orders: number };
  days: Array<{
    date: string;
    label: string;
    installed: number;
    pending: number;
    not_scheduled: number;
  }>;
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date) {
  const day = (d.getDay() + 6) % 7;
  const r = new Date(d);
  r.setDate(d.getDate() - day);
  r.setHours(0, 0, 0, 0);
  return r;
}

// Format a YYYY-MM-DD as a local date (avoids the UTC off-by-one that
// fmtDate hits on date-only strings, which would disagree with days_overdue).
function fmtYmd(ymdStr: string) {
  const [y, m, d] = ymdStr.split("-").map(Number);
  if (!y) return ymdStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Parse a YYYY-MM-DD as a LOCAL date (new Date("YYYY-MM-DD") is UTC and would
// shift a day back in Miami's negative offset).
function parseYmd(ymdStr: string) {
  const [y, m, d] = ymdStr.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function formatRange(start: string, end: string) {
  const s = parseYmd(start);
  const e = parseYmd(end);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString(
    "en-US",
    { ...opts, year: "numeric" },
  )}`;
}

const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "Single Door",
  DD: "Double Door",
  sidelite: "Door with Sidelites",
};

// ----- Configurable columns for the Pending Scheduling table -----
type PendingRow = DashboardData["unscheduled"][number];
interface PendCol {
  key: string;
  label: string;
  thClass?: string;
  cell: (o: PendingRow) => ReactNode;
  print: (o: PendingRow) => string;
  sortVal: (o: PendingRow) => string | number;
}
const PEND_COLUMNS: PendCol[] = [
  {
    key: "order",
    label: "Order #",
    cell: (o) => (
      <Link
        href={`/orders/${o.id}`}
        className="font-mono text-xs font-semibold text-indigo-700 hover:underline"
        title={o.name}
      >
        {o.dealer_ref || o.name}
      </Link>
    ),
    print: (o) => o.dealer_ref || o.name,
    sortVal: (o) => o.dealer_ref || o.name,
  },
  {
    key: "client",
    label: "Client Name",
    cell: (o) => <span className="text-slate-700">{o.client_name}</span>,
    print: (o) => o.client_name,
    sortVal: (o) => (o.client_name || "").toLowerCase(),
  },
  {
    key: "phone",
    label: "Phone",
    cell: (o) => <span className="whitespace-nowrap text-xs text-slate-600">{(o.client_phone as string) || "—"}</span>,
    print: (o) => (o.client_phone as string) || "",
    sortVal: (o) => (o.client_phone as string) || "",
  },
  {
    key: "address",
    label: "Address",
    cell: (o) => <span className="text-xs text-slate-600">{o.client_address || "—"}</span>,
    print: (o) => (o.client_address || "").replace(/\n/g, " "),
    sortVal: (o) => (o.client_address || "").toLowerCase(),
  },
  {
    // Las dos columnas del pedido #4. Van juntas y justo despues de la
    // direccion porque se leen como una sola idea: "donde queda esto".
    key: "distance",
    label: "Distancia",
    thClass: "text-right",
    cell: (o) => {
      const d = o.geo?.distance_mi;
      if (d == null || !o.geo?.range_id) return <span className="text-xs text-slate-300">—</span>;
      return (
        <span
          className="whitespace-nowrap text-right font-mono text-xs text-slate-600"
          title={o.geo.geo_approx
            ? "Aproximada: el código postal exacto no está en la tabla, se ubicó por el prefijo del condado."
            : undefined}
        >
          {fmtNum(d)} mi{o.geo.geo_approx ? "*" : ""}
        </span>
      );
    },
    print: (o) => (o.geo?.distance_mi != null ? `${fmtNum(o.geo.distance_mi)} mi` : ""),
    // Las que no se pudieron ubicar caen al final al ordenar por distancia,
    // en vez de encabezar la lista como si estuvieran al lado del taller.
    sortVal: (o) => (o.geo?.distance_mi != null ? o.geo.distance_mi : Number.MAX_SAFE_INTEGER),
  },
  {
    key: "zone",
    label: "Zona",
    cell: (o) => {
      if (!o.geo?.range_name) {
        return <span className="text-xs text-slate-400">Sin ubicar</span>;
      }
      return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
          {o.geo.range_name}
          {o.geo.corridor && (
            <span className="font-semibold text-slate-500">
              ({CORRIDOR_LABEL[o.geo.corridor] ?? o.geo.corridor})
            </span>
          )}
        </span>
      );
    },
    print: (o) =>
      o.geo?.range_name
        ? `${o.geo.range_name}${o.geo.corridor ? ` (${CORRIDOR_LABEL[o.geo.corridor] ?? o.geo.corridor})` : ""}`
        : "Sin ubicar",
    sortVal: (o) => o.geo?.distance_mi ?? Number.MAX_SAFE_INTEGER,
  },
  {
    key: "door",
    label: "Door Type",
    cell: (o) => <span className="text-xs text-slate-700">{DOOR_TYPE_LABEL[o.door_type] ?? o.door_type ?? "—"}</span>,
    print: (o) => DOOR_TYPE_LABEL[o.door_type] ?? o.door_type ?? "",
    sortVal: (o) => o.door_type || "",
  },
  {
    key: "qty",
    label: "Qty",
    thClass: "text-right",
    cell: (o) => <span className="font-mono text-xs">{o.qty}</span>,
    print: (o) => String(o.qty),
    sortVal: (o) => o.qty,
  },
  {
    key: "installer",
    label: "Installer",
    cell: (o) =>
      o.installer === "Unassigned" ? (
        <span className="text-xs text-amber-700">Unassigned</span>
      ) : (
        <span className="text-xs text-slate-600">{o.installer}</span>
      ),
    print: (o) => o.installer,
    sortVal: (o) => (o.installer || "").toLowerCase(),
  },
];
const PEND_COL_DEFAULT = [
  "order", "client", "phone", "address", "distance", "zone", "door", "qty", "installer",
];
// Columnas incorporadas despues de que existiera la preferencia guardada.
// Sin esto, cualquiera que ya hubiera tocado el menu de columnas jamas veria
// las nuevas: su lista guardada no las contiene y el filtro de validacion las
// descarta en silencio. Se agregan a lo guardado en vez de reponer el default
// entero, para no deshacerle las columnas que decidio ocultar.
const PEND_COLS_ADDED_LATER = ["distance", "zone"];
const PEND_COLS_KEY = "indigo:install-pending-cols";

// Vistas de la pantalla. La division sale del mockup que mando Majela el
// 2026-08-19: en una sola pagina larga hay que bajar mucho para llegar a lo
// que se necesita, y el tablero de arriba se pierde de vista justo cuando se
// esta decidiendo con el.
const INSTALL_VIEW_KEY = "indigo:install-view";
const INSTALL_VIEWS = [
  { key: "board", label: "Tablero" },
  { key: "pending", label: "Por agendar" },
  { key: "zones", label: "Zonas" },
  { key: "calendar", label: "Calendario" },
  { key: "installers", label: "Instaladores" },
] as const;
type InstallView = (typeof INSTALL_VIEWS)[number]["key"];

const COLOR_DOT: Record<string, string> = {
  white: "#fff",
  bronze: "#a16207",
  bronze_eco: "#854d0e",
  black: "#111",
  custom: "#a78bfa",
};

export default function InstallationsPage() {
  const [range, setRange] = useState(() => {
    const mon = startOfWeek(new Date());
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { from: ymd(mon), to: ymd(sun) };
  });
  const [q, setQ] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | number>("all");
  // Filtros de ruta sobre la tabla de pendientes por agendar.
  // Pestana activa. Se recuerda en localStorage porque cada rol vive en una
  // distinta: Majela en Board, quien agenda en Pendientes, y volver siempre a
  // Board obliga a dos clics cada vez que se entra.
  const [view, setView] = useState<InstallView>("board");
  // Cual de las dos tarjetas de espera esta mostrando su detalle completo.
  // Una sola a la vez: abrir las dos devuelve la pagina larga que se acaba
  // de desarmar.
  const [expandedHold, setExpandedHold] = useState<"dealer" | "client" | null>(null);
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [dirFilter, setDirFilter] = useState<string>("all");

  // Pending Scheduling — configurable columns (saved per user) + sort.
  const [pendColKeys, setPendColKeys] = useState<string[]>(PEND_COL_DEFAULT);
  const [pendSort, setPendSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "order",
    dir: "asc",
  });
  useEffect(() => {
    try {
      const savedView = localStorage.getItem(INSTALL_VIEW_KEY);
      if (savedView && INSTALL_VIEWS.some((v) => v.key === savedView)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setView(savedView as InstallView);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PEND_COLS_KEY);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length) {
          // Loading persisted column prefs on mount is a legitimate one-shot.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          const saved_keys = arr.filter((k: string) => PEND_COLUMNS.some((c) => c.key === k));
          const missing = PEND_COLS_ADDED_LATER.filter((k) => !saved_keys.includes(k));
          setPendColKeys(
            missing.length
              // Se insertan donde van (despues de la direccion), no al final:
              // "distancia" pegada a "dirección" se lee como una sola idea.
              ? PEND_COLUMNS.map((c) => c.key).filter(
                  (k) => saved_keys.includes(k) || missing.includes(k),
                )
              : saved_keys,
          );
        }
      }
    } catch {
      /* ignore */
    }
  }, []);
  function togglePendCol(key: string) {
    setPendColKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      const ordered = PEND_COLUMNS.filter((c) => next.includes(c.key)).map((c) => c.key);
      try {
        localStorage.setItem(PEND_COLS_KEY, JSON.stringify(ordered));
      } catch {
        /* ignore */
      }
      return ordered;
    });
  }
  function chooseView(v: InstallView) {
    setView(v);
    try {
      localStorage.setItem(INSTALL_VIEW_KEY, v);
    } catch {
      /* modo privado: la pestana simplemente no se recuerda */
    }
  }
  function sortPend(key: string) {
    setPendSort((p) => (p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }
  const visiblePendCols = PEND_COLUMNS.filter((c) => pendColKeys.includes(c.key));
  const [addInstallerOpen, setAddInstallerOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // Hold / release target — a door blocked by the dealer or the client can't
  // be scheduled at all, so "Schedule" isn't the action she needs on those
  // rows (Majela's 2026-08-15 request, item 3, audio 3: she's stuck opening
  // each order's detail page to mark it). `releasing: true` swaps the modal
  // to the release flow for rows already sitting in one of the on-hold panels.
  const [holdTarget, setHoldTarget] = useState<
    { id: number; name: string; releasing: boolean } | null
  >(null);

  // Bulk selection of orders (to mark several as Installed / send to a stage).
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [marking, setMarking] = useState(false);
  const stagesQ = useQuery<{ records: Array<{ id: number; name: string; code: string; sequence: number }> }>({
    queryKey: ["stages-list"],
    queryFn: () => fetch("/api/stages").then((r) => r.json()),
    staleTime: 10 * 60_000,
  });
  function toggleSel(id: number) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selectMany(ids: number[], on: boolean) {
    setSelected((p) => {
      const n = new Set(p);
      ids.forEach((i) => (on ? n.add(i) : n.delete(i)));
      return n;
    });
  }
  function clearSel() {
    setSelected(new Set());
  }
  function refreshDash() {
    qc.invalidateQueries({ queryKey: ["installers-dashboard"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }

  // Mark the selected orders as Installed (the "terminado" bulk action).
  async function markInstalled() {
    if (marking) return;
    const ids = Array.from(selected);
    if (!ids.length) return;
    const installed = stagesQ.data?.records?.find((s) => s.code === "installed");
    if (!installed) {
      toast.error("Stage 'Installed' not found. Reload and try again.");
      return;
    }
    if (!confirm(`Mark ${ids.length} order${ids.length === 1 ? "" : "s"} as Installed (terminado)?`)) return;
    setMarking(true);
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/orders/${id}/stage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage_id: installed.id,
            note: "Marked installed (bulk)",
            source: `Mark installed (${ids.length})`,
          }),
        }).then(async (r) => {
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
          return j;
        }),
      ),
    );
    setMarking(false);
    const failed = results.filter((r) => r.status === "rejected").length;
    refreshDash();
    clearSel();
    if (failed === 0) toast.success(`${ids.length} marked as Installed`);
    else if (failed === ids.length) toast.error(`All ${ids.length} updates failed.`);
    else toast.warning(`${ids.length - failed} of ${ids.length} marked. ${failed} failed.`);
  }

  const { data, isLoading, isError, refetch } = useQuery<DashboardData>({
    queryKey: ["installers-dashboard", range.from, range.to],
    queryFn: () =>
      fetchJson<DashboardData>(
        `/api/installers/dashboard?from=${range.from}&to=${range.to}`,
      ),
  });

  const filteredInstallers = useMemo(() => {
    if (!data) return [];
    const base = activeTab === "all"
      ? data.installers
      : data.installers.filter((i) => i.id === activeTab);
    if (!q.trim()) return base;
    const needle = q.toLowerCase();
    return base
      .map((i) => ({
        ...i,
        orders: i.orders.filter(
          (o) =>
            o.client_name.toLowerCase().includes(needle) ||
            o.name.toLowerCase().includes(needle) ||
            o.dealer_ref.toLowerCase().includes(needle) ||
            o.client_address.toLowerCase().includes(needle),
        ),
      }))
      .filter((i) => i.orders.length > 0);
  }, [data, activeTab, q]);

  // Pending installs that have no date yet — week-agnostic, so they show
  // regardless of which week is selected. This is what the dashboard
  // "Installations Pending" KPI counts that the weekly view used to hide.
  const unscheduled = useMemo(() => {
    let rows = data?.unscheduled ?? [];
    // Filtro por zona: el uso real es "muestrame solo lo que queda cerca" o
    // "solo el lado norte", para armar el dia de un instalador de una sola
    // pasada. "unlocated" existe como opcion propia porque es una lista que
    // hay que arreglar (falta el codigo postal), no un lugar.
    if (zoneFilter !== "all") {
      rows = rows.filter((o) =>
        zoneFilter === "unlocated"
          ? !o.geo?.range_id
          : o.geo?.range_id === Number(zoneFilter),
      );
    }
    if (dirFilter !== "all") {
      rows = rows.filter((o) => o.geo?.corridor === dirFilter);
    }
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter(
      (o) =>
        o.client_name.toLowerCase().includes(needle) ||
        o.name.toLowerCase().includes(needle) ||
        o.dealer_ref.toLowerCase().includes(needle) ||
        o.client_address.toLowerCase().includes(needle),
    );
  }, [data, q, zoneFilter, dirFilter]);

  // Pending rows sorted by the active column/direction.
  const sortedPending = useMemo(() => {
    const col = PEND_COLUMNS.find((c) => c.key === pendSort.key);
    if (!col) return unscheduled;
    const dir = pendSort.dir === "asc" ? 1 : -1;
    return [...unscheduled].sort((a, b) => {
      const va = col.sortVal(a);
      const vb = col.sortVal(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [unscheduled, pendSort]);

  // Overdue: scheduled in the past, still not installed. Week-agnostic.
  const overdue = useMemo(() => {
    const rows = data?.overdue ?? [];
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter(
      (o) =>
        o.client_name.toLowerCase().includes(needle) ||
        o.name.toLowerCase().includes(needle) ||
        o.dealer_ref.toLowerCase().includes(needle) ||
        o.client_address.toLowerCase().includes(needle),
    );
  }, [data, q]);

  // On hold, by cause — Majela's 2026-08-15 request (item 3). Week-agnostic
  // like unscheduled/overdue, filtered the same way by the search box.
  // Counter chips (below) use the UNfiltered door counts from `data` so
  // they stay a stable summary, same as the KPI tiles above.
  function filterHoldRows(rows: DashboardData["onHold"]["dealer"]["orders"] | undefined) {
    const list = rows ?? [];
    if (!q.trim()) return list;
    const needle = q.toLowerCase();
    return list.filter(
      (o) =>
        o.client_name.toLowerCase().includes(needle) ||
        o.name.toLowerCase().includes(needle) ||
        o.dealer_ref.toLowerCase().includes(needle) ||
        o.client_address.toLowerCase().includes(needle),
    );
  }
  const holdDealer = useMemo(() => filterHoldRows(data?.onHold.dealer.orders), [data, q]);
  const holdClient = useMemo(() => filterHoldRows(data?.onHold.client.orders), [data, q]);
  const holdOther = useMemo(() => filterHoldRows(data?.onHold.other.orders), [data, q]);

  // Days in the current range (for the prev/next period stepping).
  const rangeDays = useMemo(() => {
    const a = new Date(range.from + "T00:00:00").getTime();
    const b = new Date(range.to + "T00:00:00").getTime();
    return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
  }, [range]);

  // Shift the whole range by N days (previous / next period).
  function shiftRange(deltaDays: number) {
    setRange((r) => {
      const f = new Date(r.from + "T00:00:00");
      f.setDate(f.getDate() + deltaDays);
      const t = new Date(r.to + "T00:00:00");
      t.setDate(t.getDate() + deltaDays);
      return { from: ymd(f), to: ymd(t) };
    });
  }

  // Quick presets.
  function setThisWeek() {
    const mon = startOfWeek(new Date());
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    setRange({ from: ymd(mon), to: ymd(sun) });
  }
  function setNextWeek() {
    const mon = startOfWeek(new Date());
    mon.setDate(mon.getDate() + 7);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    setRange({ from: ymd(mon), to: ymd(sun) });
  }
  function setThisMonth() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setRange({ from: ymd(first), to: ymd(last) });
  }

  // Export what the user currently sees (respects the search + installer tab)
  // as a flat CSV — one row per scheduled door.
  function exportCsv() {
    const rows = filteredInstallers.flatMap((inst) =>
      inst.orders.map((o) => ({ installer: inst.name, o })),
    );
    if (!rows.length) {
      toast.warning("Nothing to export for this view.");
      return;
    }
    const csv = toCsv(rows, [
      { header: "Installer", value: (r) => r.installer },
      { header: "Order #", value: (r) => r.o.dealer_ref || r.o.name },
      { header: "Client", value: (r) => r.o.client_name },
      { header: "Address", value: (r) => r.o.client_address?.replace(/\n/g, " ") },
      { header: "Door Type", value: (r) => DOOR_TYPE_LABEL[r.o.door_type] ?? r.o.door_type },
      { header: "Color", value: (r) => r.o.color },
      { header: "Qty", value: (r) => r.o.qty },
      { header: "Status", value: (r) => r.o.status },
      { header: "Scheduled", value: (r) => (r.o.scheduled_date ? String(r.o.scheduled_date) : "") },
    ]);
    downloadCsv(`installations-${range.from}_${range.to}.csv`, csv);
    toast.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  }

  // Print the Pending Scheduling worklist (respects the search) as a sheet to
  // call clients and plan dates on paper. Includes phone + a blank "Scheduled
  // date" column to write the agreed date in.
  function printPending() {
    const rows = sortedPending;
    if (!rows.length) {
      toast.warning("Nothing to print in Pending Scheduling.");
      return;
    }
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Allow pop-ups to print the list");
      return;
    }
    const esc = (v: unknown) =>
      String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
    // Print follows the columns chosen on screen, + a blank "Scheduled date".
    const cols = visiblePendCols;
    const head =
      `<th>#</th>` +
      cols.map((c) => `<th${c.thClass ? ' class="r"' : ""}>${esc(c.label)}</th>`).join("") +
      `<th>Scheduled date</th>`;
    const body = rows
      .map(
        (o, i) =>
          `<tr><td>${i + 1}</td>` +
          cols.map((c) => `<td${c.thClass ? ' class="r"' : ""}>${esc(c.print(o))}</td>`).join("") +
          `<td class="sd"></td></tr>`,
      )
      .join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>Installations — Pending Scheduling</title>
      <style>
        body{margin:22px;color:#111;font-family:Arial,Helvetica,sans-serif;}
        h1{font-size:17px;margin:0 0 2px;color:#1f4486;}
        .sub{font-size:11px;color:#555;margin-bottom:12px;}
        table{width:100%;border-collapse:collapse;font-size:10px;}
        th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top;}
        th{background:#1f4486;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        td.r,th.r{text-align:right;white-space:nowrap;}
        td.nw{white-space:nowrap;}
        td.sd{width:90px;}
        thead{display:table-header-group;}
        tr{page-break-inside:avoid;}
        @page{size:landscape;margin:12mm;}
      </style></head><body>
      <h1>Indigo Decors — Pending Scheduling</h1>
      <div class="sub">${rows.length} order${rows.length === 1 ? "" : "s"} to schedule${q ? ` · filter “${esc(q)}”` : ""} · ${esc(new Date().toLocaleString())}</div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      <script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>
      </body></html>`);
    w.document.close();
  }

  const summary = data?.summary;

  // Donut data
  const donutData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: "Installed", value: summary.installedThisWeek, fill: "#10b981" },
      { name: "Pending", value: summary.pendingThisWeek, fill: "#f59e0b" },
    ];
  }, [summary]);

  if (isError) {
    return (
      <div className="mx-auto max-w-[1700px]">
        <ErrorState
          title="Couldn't load installations"
          message="The installations board failed to load. Check your connection and try again."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1700px] space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Installations
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage doors assigned to installers and track installation progress.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72">
            <Search
              size={16}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            />
            <Input
              placeholder="Search by order, client or reference..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-10 pl-10"
            />
          </div>
          <Button variant="outline" size="lg" onClick={printPending}>
            <Printer size={14} /> Print list
          </Button>
          <Button variant="outline" size="lg" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </Button>
          <Button size="lg" onClick={() => setAddInstallerOpen(true)}>
            <Plus size={14} /> Add Installer
          </Button>
        </div>
      </header>

      {/* Date-range control — the whole board reflects installations whose
          scheduled date falls inside this range (e.g. Mon 7 → Sat 12). */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Calendar size={15} className="text-indigo-700" />
          Showing installations
        </span>
        <input
          type="date"
          value={range.from}
          max={range.to}
          onChange={(e) => {
            // Keep from <= to even if the user types a later date into "from"
            // (the max= attribute only guards the calendar popup, not typing).
            const from = e.target.value;
            if (from) setRange((r) => ({ from, to: r.to < from ? from : r.to }));
          }}
          aria-label="From date"
          className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
        />
        <span className="text-slate-400">to</span>
        <input
          type="date"
          value={range.to}
          min={range.from}
          onChange={(e) => {
            const to = e.target.value;
            if (to) setRange((r) => ({ to, from: r.from > to ? to : r.from }));
          }}
          aria-label="To date"
          className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
        />
        <div className="ml-1 flex items-center gap-1">
          <RangePreset onClick={setThisWeek}>This week</RangePreset>
          <RangePreset onClick={setNextWeek}>Next week</RangePreset>
          <RangePreset onClick={setThisMonth}>This month</RangePreset>
        </div>
        <div className="ml-auto flex items-center gap-1 text-xs text-slate-600">
          <button
            type="button"
            onClick={() => shiftRange(-rangeDays)}
            className="rounded p-1 hover:bg-slate-100"
            aria-label="Previous period"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[130px] text-center font-medium">
            {formatRange(range.from, range.to)}
          </span>
          <button
            type="button"
            onClick={() => shiftRange(rangeDays)}
            className="rounded p-1 hover:bg-slate-100"
            aria-label="Next period"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* Pestanas. Cada una responde una pregunta distinta, y llevan el
          contador de lo que hay dentro para no tener que entrar a mirar. */}
      <nav className="flex flex-wrap items-center gap-1 border-b border-slate-200">
        {INSTALL_VIEWS.map((v) => {
          const count =
            v.key === "pending"
              ? (data?.unscheduled.length ?? 0) + (data?.overdue.length ?? 0)
              : v.key === "zones"
                ? (data?.zones ?? []).reduce((a, z) => a + z.doors, 0) +
                  (data?.zonesUnlocated?.doors ?? 0)
                : v.key === "installers"
                  ? (data?.installers.length ?? 0)
                  : null;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => chooseView(v.key)}
              aria-current={view === v.key ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition",
                view === v.key
                  ? "border-indigo-700 text-indigo-800"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
              )}
            >
              {v.label}
              {count != null && count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                    view === v.key ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-500",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Dialogos y barra masiva: FUERA de cualquier bloque de pestana.
          Los botones que los abren estan repartidos por varias -- Reschedule
          y Hold en "Por agendar", Reschedule en "Instaladores", "Add
          installer" en la cabecera -- asi que montarlos dentro de
          `view === "board"` hacia que en las demas el clic cambiara el
          estado y no abriera nada: un boton que se ve, se puede pulsar, y no
          hace absolutamente nada. Sin peticion, sin error, sin aviso. */}
      <AddInstallerModal
        open={addInstallerOpen}
        onClose={() => setAddInstallerOpen(false)}
      />

      <ScheduleInstallationModal
        target={scheduleTarget}
        onClose={() => setScheduleTarget(null)}
      />

      <HoldModal
        open={holdTarget !== null}
        onClose={() => setHoldTarget(null)}
        onSuccess={refreshDash}
        orderId={holdTarget?.id ?? 0}
        orderName={holdTarget?.name ?? ""}
        releasing={holdTarget?.releasing ?? false}
      />

      {/* Bulk action bar — appears when orders are selected. Mark several as
          Installed ("terminado") at once, or send them to another stage.
          Se muestra en las dos pestanas que tienen casillas: en "Por agendar"
          se podian marcar filas y la barra no aparecia nunca. */}
      {selected.size > 0 && (view === "board" || view === "pending") && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 shadow-sm">
          <Badge variant="secondary" className="bg-indigo-100 text-xs font-bold uppercase tracking-wide text-indigo-700">
            {selected.size} selected
            <button
              type="button"
              onClick={clearSel}
              aria-label="Clear selection"
              className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-indigo-200"
            >
              <X size={10} />
            </button>
          </Badge>
          <Button
            size="sm"
            onClick={markInstalled}
            disabled={marking}
            className="bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700 disabled:opacity-60"
          >
            <CheckSquare size={13} />
            {marking ? "Marking…" : "Mark as Installed"}
          </Button>
          <BulkSendToButton
            orderIds={Array.from(selected)}
            stages={stagesQ.data?.records ?? []}
            onSuccess={() => {
              clearSel();
              refreshDash();
            }}
          />
          <button
            type="button"
            onClick={clearSel}
            className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            Clear
          </button>
        </div>
      )}

      {view === "board" && (<>
      {/* On-hold counters, by cause — Majela's 2026-08-15 request: "arriba"
          ("va a estar eso recorrido en la parte superior"), independent of
          the week range below (holds aren't tied to a scheduled date). The
          label carries the meaning on its own (not just the color) so it
          reads the same for anyone who can't easily tell blue from orange. */}
      {data && (data.onHold.dealer.doorCount > 0 || data.onHold.client.doorCount > 0 || data.onHold.other.doorCount > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            On hold
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">
            <Building2 size={12} />
            {holdCounterLabel("dealer", data.onHold.dealer.doorCount)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-800">
            <UserRound size={12} />
            {holdCounterLabel("client", data.onHold.client.doorCount)}
          </span>
          {data.onHold.other.doorCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              <HelpCircle size={12} />
              {holdCounterLabel("other", data.onHold.other.doorCount)}
            </span>
          )}
        </div>
      )}

      {data?.truncated && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <AlertTriangle size={15} className="flex-none text-amber-600" />
          This range has {fmtNum(data.totalInRange ?? 0)} installations — more than
          can be shown at once, so the KPIs and lists below are partial. Narrow the
          date range for complete numbers.
        </div>
      )}

      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiTile
          label="Doors to Install"
          value={fmtNum(summary?.doorsToInstall ?? 0)}
          hint="In queue"
          icon={FolderOpen}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-700"
        />
        <KpiTile
          label="Scheduled"
          value={fmtNum(summary?.scheduled ?? 0)}
          hint="On calendar"
          icon={Calendar}
          iconBg="bg-sky-50"
          iconColor="text-sky-600"
        />
        <KpiTile
          label="Installed"
          value={fmtNum(summary?.installedThisWeek ?? 0)}
          hint="In range"
          icon={CheckSquare}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
        />
        {/* Los dos motivos de traba, como tarjeta y no como insignia dentro
            del panel: son los numeros con los que ella decide a quien
            llamar, y estaban a media pantalla de distancia. */}
        <KpiTile
          label="Pending – Client"
          value={fmtNum(data?.onHold.client.doorCount ?? 0)}
          hint="Needs follow-up"
          icon={UserRound}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
        />
        <KpiTile
          label="On Hold – Dealer"
          value={fmtNum(data?.onHold.dealer.doorCount ?? 0)}
          hint="Dealer action"
          icon={Wrench}
          iconBg="bg-rose-50"
          iconColor="text-rose-600"
        />
      </section>

      {/* Las tres tarjetas lado a lado. Son las tres preguntas que se hacen
          juntas al planificar el dia: que espera al dealer, que espera al
          cliente, y de que lado queda lo que se puede hacer. Apiladas a lo
          ancho obligaban a bajar dos pantallas para compararlas -- y la
          comparacion ES la decision.

          Aca van resumidas (las primeras filas y lo justo para reconocer una
          orden). "Ver todas" abre el detalle completo debajo, en vez de
          llevar a otra pantalla: la decision se toma con las tres a la vista,
          asi que sacarla de aca seria deshacer el motivo del cambio. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <HoldSummaryCard
          icon={UserRound}
          title="PENDING – CLIENT"
          subtitle="Esperando al cliente"
          theme={HOLD_SECTION_THEME.client}
          rows={holdClient}
          doorCount={data?.onHold.client.doorCount ?? 0}
          expanded={expandedHold === "client"}
          onToggle={() => setExpandedHold(expandedHold === "client" ? null : "client")}
        />
        <HoldSummaryCard
          icon={Building2}
          title="ON HOLD – DEALER"
          subtitle="Trabada por el dealer"
          theme={HOLD_SECTION_THEME.dealer}
          rows={holdDealer}
          doorCount={data?.onHold.dealer.doorCount ?? 0}
          expanded={expandedHold === "dealer"}
          onToggle={() => setExpandedHold(expandedHold === "dealer" ? null : "dealer")}
        />
        <ZonesPanel
          zones={data?.zones ?? []}
          unlocated={data?.zonesUnlocated}
          compact
          onViewAll={() => chooseView("zones")}
        />
      </div>

      </>)}

      {(view === "board" || view === "pending") && (<>
      {/* Overdue — scheduled in the past but still not installed. Highest
          priority: these slip through both the weekly view (past week) and
          the Pending Scheduling panel (they have a date). */}
      {overdue.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-rose-200 bg-rose-50/50 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 px-5 py-3">
            <h3 className="flex items-center gap-1.5 font-semibold text-rose-900">
              <AlertTriangle size={15} className="text-rose-600" />
              Overdue Installations
              <Badge
                variant="secondary"
                className="bg-rose-200 text-[10px] font-bold text-rose-800"
              >
                {overdue.length}
              </Badge>
            </h3>
            <span className="text-xs text-rose-700">
              Scheduled date has passed and not marked installed. Reschedule or
              open the order to close it out.
            </span>
          </div>
          {/* Movil: tarjetas. La tabla mide 900 px en una ventana de 364, asi
              que la direccion, la fecha y los botones quedaban a tres
              pantallas de arrastre -- y Reschedule/Hold median 28 px de alto,
              muy por debajo de los 44 que pide un dedo. */}
          <MobileCardList className="p-3">
            {overdue.map((o) => (
              <MobileRowCard
                key={o.id}
                selected={selected.has(o.id)}
                onSelect={() => toggleSel(o.id)}
                selectLabel={`Select ${o.dealer_ref || o.name}`}
                title={
                  <Link href={`/orders/${o.id}`} className="text-indigo-700 hover:underline">
                    {o.dealer_ref || o.name}
                  </Link>
                }
                subtitle={o.client_name}
                badge={
                  <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                    {o.days_overdue}d late
                  </span>
                }
                fields={[
                  { label: "Scheduled", value: fmtYmd(o.scheduled_date) },
                  { label: "Qty", value: String(o.qty) },
                  {
                    label: "Installer",
                    value:
                      o.installer === "Unassigned" ? (
                        <span className="text-rose-700">Unassigned</span>
                      ) : (
                        o.installer
                      ),
                  },
                  { label: "Address", value: o.client_address || "—", wide: true },
                ]}
                action={
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setScheduleTarget({
                          id: o.id,
                          label: o.dealer_ref || o.name,
                          clientName: o.client_name,
                          installerIds: o.installer_ids,
                          scheduled: true,
                          date: o.scheduled_date,
                        })
                      }
                      className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-600 text-sm font-semibold text-white transition hover:bg-rose-700"
                    >
                      <Calendar size={15} /> Reschedule
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setHoldTarget({ id: o.id, name: o.dealer_ref || o.name, releasing: false })
                      }
                      className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:border-amber-400 hover:bg-amber-50"
                    >
                      <Pause size={15} /> Hold
                    </button>
                  </div>
                }
              />
            ))}
          </MobileCardList>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-rose-100/60 text-left text-[10px] font-bold uppercase tracking-wide text-rose-800">
                <tr>
                  <th className="px-3 py-2.5 w-8">
                    <Checkbox
                      checked={overdue.length > 0 && overdue.every((o) => selected.has(o.id))}
                      onCheckedChange={(v) => selectMany(overdue.map((o) => o.id), !!v)}
                      aria-label="Select all overdue"
                    />
                  </th>
                  <th className="px-4 py-2.5">Order Number</th>
                  <th className="px-4 py-2.5">Client Name</th>
                  <th className="px-4 py-2.5">Address</th>
                  <th className="px-4 py-2.5">Scheduled</th>
                  <th className="px-4 py-2.5 text-right">Qty</th>
                  <th className="px-4 py-2.5">Installer</th>
                  <th className="px-4 py-2.5 w-44"></th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((o) => (
                  <tr
                    key={o.id}
                    className={cn(
                      "border-t border-rose-100 transition hover:bg-rose-100/40",
                      selected.has(o.id) && "bg-rose-100/60",
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <Checkbox
                        checked={selected.has(o.id)}
                        onCheckedChange={() => toggleSel(o.id)}
                        aria-label={`Select ${o.dealer_ref || o.name}`}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/orders/${o.id}`}
                        className="font-mono text-xs font-semibold text-indigo-700 hover:underline"
                        title={o.name}
                      >
                        {o.dealer_ref || o.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{o.client_name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {o.client_address || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className="text-slate-600">
                        {fmtYmd(o.scheduled_date)}
                      </span>
                      <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                        {o.days_overdue}d late
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {o.qty}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {o.installer === "Unassigned" ? (
                        <span className="text-rose-700">Unassigned</span>
                      ) : (
                        o.installer
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setScheduleTarget({
                              id: o.id,
                              label: o.dealer_ref || o.name,
                              clientName: o.client_name,
                              installerIds: o.installer_ids,
                              scheduled: true,
                              date: o.scheduled_date,
                            })
                          }
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg bg-rose-600 px-2.5 text-[11px] font-semibold text-white transition hover:bg-rose-700"
                        >
                          <Calendar size={11} /> Reschedule
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setHoldTarget({
                              id: o.id,
                              name: o.dealer_ref || o.name,
                              releasing: false,
                            })
                          }
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800"
                        >
                          <Pause size={11} /> Hold
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pending scheduling — orders awaiting an installation date. These are
          counted in the dashboard "Installations Pending" KPI but have no
          date, so they don't appear in any week. Surface them here so they
          can be opened and scheduled. */}
      {(data?.unscheduled.length ?? 0) > 0 && (
        <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/50 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 px-5 py-3">
            <h3 className="flex items-center gap-1.5 font-semibold text-amber-900">
              <Calendar size={15} className="text-amber-600" />
              Pending Scheduling
              <Badge
                variant="secondary"
                className="bg-amber-200 text-[10px] font-bold text-amber-800"
              >
                {unscheduled.length}
              </Badge>
            </h3>
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-amber-700 sm:inline">
                Ready to install — no date yet.
              </span>
              {/* Filtros de ruta (pedido #4). Van aca y no arriba porque
                  acotan esta tabla, no el tablero entero. */}
              <select
                aria-label="Filtrar por zona"
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
                className="h-8 rounded-lg border border-amber-300 bg-white px-2 text-xs font-medium text-amber-800 focus-visible:outline-none"
              >
                <option value="all">Todas las zonas</option>
                {(data?.zones ?? []).map((z) => (
                  <option key={z.id} value={String(z.id)}>
                    {z.name}
                  </option>
                ))}
                {!!data?.zonesUnlocated?.orders && (
                  <option value="unlocated">Sin ubicar</option>
                )}
              </select>
              <select
                aria-label="Filtrar por corredor"
                value={dirFilter}
                onChange={(e) => setDirFilter(e.target.value)}
                className="h-8 rounded-lg border border-amber-300 bg-white px-2 text-xs font-medium text-amber-800 focus-visible:outline-none"
              >
                <option value="all">Todos los corredores</option>
                {Object.entries(CORRIDOR_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-800 transition hover:bg-amber-50 focus-visible:outline-none">
                  <Columns3 size={13} /> Columns
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Columns
                    </DropdownMenuLabel>
                    {PEND_COLUMNS.map((c) => (
                      <DropdownMenuCheckboxItem
                        key={c.key}
                        checked={pendColKeys.includes(c.key)}
                        closeOnClick={false}
                        onCheckedChange={() => togglePendCol(c.key)}
                      >
                        {c.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {/* Movil: tarjetas, igual que en Overdue. Aqui las columnas son
              configurables por usuario, asi que la tarjeta muestra las que
              esa persona eligio ver -- si se ocultan en la tabla, se ocultan
              tambien aqui, en vez de tener dos verdades distintas. */}
          <MobileCardList className="p-3">
            {sortedPending.map((o) => (
              <MobileRowCard
                key={o.id}
                selected={selected.has(o.id)}
                onSelect={() => toggleSel(o.id)}
                selectLabel={`Select ${o.dealer_ref || o.name}`}
                title={
                  <Link href={`/orders/${o.id}`} className="text-indigo-700 hover:underline">
                    {o.dealer_ref || o.name}
                  </Link>
                }
                subtitle={o.client_name}
                fields={visiblePendCols
                  .filter((c) => c.key !== "order" && c.key !== "client")
                  .map((c) => ({
                    label: c.label,
                    value: c.cell(o),
                    wide: c.key === "address",
                  }))}
                action={
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setScheduleTarget({
                          id: o.id,
                          label: o.dealer_ref || o.name,
                          clientName: o.client_name,
                          installerIds: o.installer_ids,
                        })
                      }
                      className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-600 text-sm font-semibold text-white transition hover:bg-amber-700"
                    >
                      <Calendar size={15} /> Schedule
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setHoldTarget({ id: o.id, name: o.dealer_ref || o.name, releasing: false })
                      }
                      className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:border-amber-400 hover:bg-amber-50"
                    >
                      <Pause size={15} /> Hold
                    </button>
                  </div>
                }
              />
            ))}
            {sortedPending.length === 0 && (
              <p className="rounded-2xl border border-amber-200 bg-white p-6 text-center text-sm text-amber-800">
                Ninguna orden pendiente cae en ese filtro.
              </p>
            )}
          </MobileCardList>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-amber-100/60 text-left text-[10px] font-bold uppercase tracking-wide text-amber-800">
                <tr>
                  <th className="px-3 py-2.5 w-8">
                    <Checkbox
                      checked={sortedPending.length > 0 && sortedPending.every((o) => selected.has(o.id))}
                      onCheckedChange={(v) => selectMany(sortedPending.map((o) => o.id), !!v)}
                      aria-label="Select all pending"
                    />
                  </th>
                  {visiblePendCols.map((c) => (
                    <th key={c.key} className={`px-4 py-2.5 ${c.thClass ?? ""}`}>
                      <button
                        type="button"
                        onClick={() => sortPend(c.key)}
                        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-amber-900"
                      >
                        {c.label}
                        {pendSort.key === c.key && (
                          <span>{pendSort.dir === "asc" ? "▲" : "▼"}</span>
                        )}
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 w-44"></th>
                </tr>
              </thead>
              <tbody>
                {sortedPending.map((o) => (
                  <tr
                    key={o.id}
                    className={cn(
                      "border-t border-amber-100 transition hover:bg-amber-100/40",
                      selected.has(o.id) && "bg-amber-100/70",
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <Checkbox
                        checked={selected.has(o.id)}
                        onCheckedChange={() => toggleSel(o.id)}
                        aria-label={`Select ${o.dealer_ref || o.name}`}
                      />
                    </td>
                    {visiblePendCols.map((c) => (
                      <td key={c.key} className={`px-4 py-2.5 ${c.thClass ?? ""}`}>
                        {c.cell(o)}
                      </td>
                    ))}
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setScheduleTarget({
                              id: o.id,
                              label: o.dealer_ref || o.name,
                              clientName: o.client_name,
                              installerIds: o.installer_ids,
                            })
                          }
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg bg-amber-600 px-2.5 text-[11px] font-semibold text-white transition hover:bg-amber-700"
                        >
                          <Calendar size={11} /> Schedule
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setHoldTarget({
                              id: o.id,
                              name: o.dealer_ref || o.name,
                              releasing: false,
                            })
                          }
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800"
                        >
                          <Pause size={11} /> Hold
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {/* Sin esto, filtrar hasta dejar cero filas mostraba una
                    tabla vacia sin explicacion -- y como la seccion entera
                    depende de tener filas, antes desaparecian tambien los
                    filtros y no habia forma de deshacerlos. */}
                {sortedPending.length === 0 && (
                  <tr>
                    <td
                      colSpan={visiblePendCols.length + 2}
                      className="px-4 py-8 text-center text-sm text-amber-800"
                    >
                      Ninguna orden pendiente cae en ese filtro.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setZoneFilter("all");
                          setDirFilter("all");
                        }}
                        className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
                      >
                        Ver todas
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      </>)}

      {view === "board" && (<>
      {/* Sin clasificar: no estaba en el mockup, pero mientras existan es lo
          primero que hay que resolver -- son ordenes que no aparecen en
          ninguno de los dos contadores de arriba. Va a lo ancho porque es una
          lista para vaciar, no para consultar. */}
      <HoldSection
        icon={HelpCircle}
        title="ON HOLD – UNCLASSIFIED"
        subtitle="No cause set yet — open each order and pick Dealer or Client."
        theme={HOLD_SECTION_THEME.other}
        rows={holdOther}
        onRelease={(o) => setHoldTarget({ id: o.id, name: o.dealer_ref || o.name, releasing: true })}
      />

      {expandedHold === "client" && (
        <HoldSection
          icon={UserRound}
          title="PENDING – CLIENT"
          subtitle="Blocked by the client — not available or hasn't confirmed."
          theme={HOLD_SECTION_THEME.client}
          rows={holdClient}
          onRelease={(o) => setHoldTarget({ id: o.id, name: o.dealer_ref || o.name, releasing: true })}
        />
      )}
      {expandedHold === "dealer" && (
        <HoldSection
          icon={Building2}
          title="ON HOLD – DEALER"
          subtitle="Blocked by the dealer — waiting on them to fix or provide something."
          theme={HOLD_SECTION_THEME.dealer}
          rows={holdDealer}
          onRelease={(o) => setHoldTarget({ id: o.id, name: o.dealer_ref || o.name, releasing: true })}
        />
      )}

      </>)}

      {view === "zones" && (
        <ZonesPanel zones={data?.zones ?? []} unlocated={data?.zonesUnlocated} />
      )}

      {/* Body */}
      <div
        className={cn(
          "grid grid-cols-1 gap-4 lg:grid-cols-12",
          view !== "installers" && view !== "calendar" && "hidden",
        )}
      >
        {/* LEFT — installer assignments */}
        <div
          className={cn(
            "overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100",
            view === "installers" ? "lg:col-span-8" : "hidden",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <h3 className="flex items-center gap-1.5 font-semibold text-slate-800">
              Installers and Assignments
              <Info size={13} className="text-slate-400" />
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                <Calendar size={12} className="text-slate-400" />
                {data ? formatRange(data.rangeStart, data.rangeEnd) : "—"}
              </div>
            </div>
          </div>

          {/* Tabs row */}
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 pt-2 text-xs">
            <TabChip
              label="All Installers"
              count={data?.installers.length ?? 0}
              active={activeTab === "all"}
              onClick={() => setActiveTab("all")}
            />
            {data?.installers.map((i) => (
              <TabChip
                key={i.id}
                label={shortName(i.name)}
                count={i.doors}
                active={activeTab === i.id}
                onClick={() => setActiveTab(i.id)}
              />
            ))}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Order Number</th>
                  <th className="px-4 py-3">Client Name</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3">Door Type</th>
                  <th className="px-4 py-3">Color</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Scheduled Date</th>
                  <th className="px-4 py-3 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <TableRowsSkeleton rows={6} cols={9} />}
                {!isLoading && filteredInstallers.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-12 text-center text-xs text-slate-400">
                      No installer assignments in this range.
                    </td>
                  </tr>
                )}
                {filteredInstallers.map((inst) => {
                  const open = !collapsed.has(inst.id);
                  return (
                    <FragmentRows key={inst.id}>
                      <tr className="bg-slate-50/60 border-t border-slate-100">
                        <td colSpan={9} className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsed((prev) => {
                                const next = new Set(prev);
                                if (next.has(inst.id)) next.delete(inst.id);
                                else next.add(inst.id);
                                return next;
                              })
                            }
                            className="flex w-full items-center justify-between text-left"
                          >
                            <div className="flex items-center gap-2">
                              <ChevronDown
                                size={14}
                                className={cn(
                                  "text-slate-500 transition",
                                  !open && "-rotate-90",
                                )}
                              />
                              <Users size={14} className="text-indigo-700" />
                              <span className="font-semibold text-slate-800">
                                {inst.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <span>
                                <strong className="text-slate-700">{inst.doors}</strong>{" "}
                                Doors
                              </span>
                              <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
                                {inst.installed} Installed
                              </span>
                              <span className="rounded-md bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">
                                {inst.pending} Pending
                              </span>
                            </div>
                          </button>
                        </td>
                      </tr>
                      {open &&
                        inst.orders.map((o) => (
                          <tr
                            key={`${inst.id}-${o.id}`}
                            className="border-t border-slate-100 transition hover:bg-slate-50"
                          >
                            <td className="px-4 py-2.5">
                              <Link
                                href={`/orders/${o.id}`}
                                className="font-mono text-xs font-semibold text-indigo-700 hover:underline"
                                title={o.name}
                              >
                                {o.dealer_ref || o.name}
                              </Link>
                            </td>
                            <td className="px-4 py-2.5 text-slate-700">
                              {o.client_name}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600">
                              {o.client_address}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-700">
                              {DOOR_TYPE_LABEL[o.door_type] ?? o.door_type ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 capitalize">
                              <span className="flex items-center gap-1.5 text-xs">
                                <span
                                  className="inline-block h-2.5 w-2.5 rounded-full border border-slate-300"
                                  style={{
                                    background:
                                      COLOR_DOT[o.color] ?? "#cbd5e1",
                                  }}
                                />
                                {o.color?.replace("_", " ") || "—"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs font-mono">
                              {o.qty}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusPill status={o.status} stageCode={o.stage_code} />
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600">
                              {fmtDate(o.scheduled_date as string)}
                            </td>
                            <td className="px-4 py-2.5">
                              {o.status === "scheduled" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setScheduleTarget({
                                      id: o.id,
                                      label: o.dealer_ref || o.name,
                                      clientName: o.client_name,
                                      installerIds: [inst.id],
                                      scheduled: true,
                                      date: (o.scheduled_date as string) || undefined,
                                    })
                                  }
                                  className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50"
                                >
                                  <Calendar size={11} /> Reschedule
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </FragmentRows>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
            Showing 1 to {filteredInstallers.length} of{" "}
            {data?.installers.length ?? 0} installers
          </div>
        </div>

        {/* RIGHT — widgets */}
        <div
          className={cn(
            "space-y-4",
            view === "installers" ? "lg:col-span-4" : "lg:col-span-12",
          )}
        >
          {/* Installer Overview Donut */}
          {view === "installers" && (<>
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h3 className="mb-3 font-semibold text-slate-800">
              Installer Overview
            </h3>
            <div className="flex items-center gap-3">
              <div className="relative h-36 w-36 flex-none">
                <ResponsiveContainer>
                  <RPieChart>
                    <Pie
                      data={donutData}
                      innerRadius={42}
                      outerRadius={62}
                      dataKey="value"
                      paddingAngle={2}
                    >
                      {donutData.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Pie>
                  </RPieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-slate-900">
                    {summary?.doorsToInstall ?? 0}
                  </span>
                  <span className="text-[10px] text-slate-500">Total Doors</span>
                </div>
              </div>
              <ul className="flex-1 space-y-1.5 text-xs">
                {donutData.map((d) => {
                  const total = summary?.doorsToInstall || 1;
                  const pct = ((d.value / total) * 100).toFixed(1);
                  return (
                    <li key={d.name} className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: d.fill }}
                      />
                      <span className="text-slate-600">{d.name}</span>
                      <span className="ml-auto font-semibold text-slate-800">
                        {d.value}
                      </span>
                      <span className="text-slate-400">({pct}%)</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          </>)}

          {view === "calendar" && (<>
          {/* Weekly Installation Summary */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h3 className="mb-2 font-semibold text-slate-800">
              Installation Summary
            </h3>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
              <button
                type="button"
                onClick={() => shiftRange(-rangeDays)}
                className="rounded p-1 hover:bg-slate-100"
                aria-label="Previous period"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="font-medium">
                {data ? formatRange(data.rangeStart, data.rangeEnd) : "—"}
              </span>
              <button
                type="button"
                onClick={() => shiftRange(rangeDays)}
                className="rounded p-1 hover:bg-slate-100"
                aria-label="Next period"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="h-44">
              <ResponsiveContainer>
                <BarChart data={data?.days ?? []} barCategoryGap={6}>
                  <XAxis
                    dataKey="label"
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      fontSize: 11,
                    }}
                  />
                  <Bar
                    dataKey="installed"
                    stackId="a"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="pending"
                    stackId="a"
                    fill="#f59e0b"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="not_scheduled"
                    stackId="a"
                    fill="#cbd5e1"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Installed
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Pending
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-slate-300" /> Not Scheduled
              </span>
            </div>
            {data && data.days.length < rangeDays && (
              <p className="mt-1 text-center text-[10px] text-slate-400">
                Chart shows the first {data.days.length} days; the totals above
                cover the full range.
              </p>
            )}
          </div>

          </>)}

          {view === "installers" && (<>
          {/* Payment Summary */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h3 className="mb-3 font-semibold text-slate-800">
              Payment Summary (in range)
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between text-slate-600">
                <dt className="flex items-center gap-1.5">
                  <CheckSquare size={12} className="text-slate-400" />
                  Installations Completed
                </dt>
                <dd className="font-semibold text-slate-900">
                  {summary?.installedThisWeek ?? 0} Doors
                </dd>
              </div>
              {/* Sin "Payment per Door": cada instalador tiene su propia
                  regla (piso diario, bono de viaje) y uno de ellos no cobra
                  por puerta en absoluto, asi que una tarifa unica mentiria. */}
              <div className="flex items-center justify-between text-slate-600">
                <dt className="flex items-center gap-1.5">
                  <CircleDollarSign size={12} className="text-slate-400" />
                  Still scheduled
                </dt>
                <dd className="font-semibold text-slate-900">
                  {fmtMoney(summary?.paymentForecast ?? 0)}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
                <dt className="font-bold">Earned this week</dt>
                <dd className="font-bold">
                  {fmtMoney(summary?.paymentDue ?? 0)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 flex items-center gap-1 text-[10px] text-slate-400">
              <Info size={9} />
              Earned comes from the settled day rates.{" "}
              <Link href="/installers" className="underline hover:text-slate-600">
                See it day by day
              </Link>
            </p>
          </div>
          </>)}
        </div>
      </div>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** Los cinco corredores de manejo que definio Majela el 2026-08-19. No son
 *  rumbos de brujula: describen por que autopista se sale. Fort Myers y Doral
 *  caen los dos "al oeste" y son viajes completamente distintos -- uno cruza
 *  los Everglades por Alligator Alley y el otro esta a 17 millas. */
const CORRIDOR_LABEL: Record<string, string> = {
  S: "SOUTH",
  C: "CENTRAL",
  W: "WEST",
  N: "NORTH",
  SW: "SOUTHWEST",
};

/** Como se llega, en una linea. Es lo que hace util la etiqueta para quien
 *  arma la ruta y todavia no se sabe los codigos de memoria. */
const CORRIDOR_HINT: Record<string, string> = {
  S: "South Miami-Dade y los Cayos",
  C: "Miami y el área inmediata al taller",
  W: "Doral, Sweetwater, Tamiami, Weston",
  N: "I-95 / Turnpike hacia Broward y Palm Beach",
  SW: "Costa oeste: Naples, Fort Myers",
};

/**
 * Zonas de instalacion — el pedido #4 de Majela.
 *
 * Cuenta lo que queda POR HACER (por agendar + vencidas + en espera), no el
 * historico: la pregunta que responde es "que me falta y de que lado me
 * queda", no "cuanto instale este anio". Los rangos y sus colores salen de
 * Odoo (Config -> Rangos de instalacion), asi que ella los mueve sin que
 * haya que tocar y redesplegar esta pantalla.
 */
function ZonesPanel({
  zones,
  unlocated,
  compact = false,
  onViewAll,
}: {
  zones: DashboardData["zones"];
  unlocated?: DashboardData["zonesUnlocated"];
  /** En la fila de tres columnas no entra la tabla completa: se muestran el
   *  rango y las puertas, que es lo que se compara de un vistazo, y el resto
   *  (distancia exacta, lados, ordenes) queda en la pestana Zonas. */
  compact?: boolean;
  onViewAll?: () => void;
}) {
  if (!zones.length) return null;
  const totalDoors = zones.reduce((a, z) => a + z.doors, 0) + (unlocated?.doors ?? 0);

  if (compact) {
    return (
      <section className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <MapPin size={14} className="text-indigo-700" />
              ZONAS DE INSTALACIÓN
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">Distancia desde el taller</p>
          </div>
          <Badge variant="secondary" className="shrink-0 bg-slate-100 text-[10px] font-bold text-slate-600">
            {totalDoors} {totalDoors === 1 ? "puerta" : "puertas"}
          </Badge>
        </div>
        <div className="flex-1">
          <table className="w-full text-sm">
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: z.color }}
                      />
                      <span className="truncate text-xs font-medium text-slate-700">{z.name}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-slate-800">
                    {z.doors}
                  </td>
                </tr>
              ))}
              {!!unlocated?.orders && (
                <tr className="border-t border-slate-100 bg-slate-50/60">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                      <span className="truncate text-xs font-medium text-slate-500">Sin ubicar</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-slate-600">
                    {unlocated.doors}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="flex items-center justify-center gap-1.5 border-t border-slate-200 px-4 py-2.5 text-xs font-semibold text-indigo-700 transition hover:opacity-75"
          >
            Ver detalle de zonas
            <ArrowRight size={13} />
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <h3 className="flex items-center gap-1.5 font-semibold text-slate-800">
          <MapPin size={15} className="text-indigo-700" />
          Zonas de instalación
        </h3>
        <span className="text-xs text-slate-500">
          {totalDoors} puerta{totalDoors === 1 ? "" : "s"} pendiente
          {totalDoors === 1 ? "" : "s"} · cada corredor es una tanda aparte: 35 millas
          al norte y 35 al sur no son el mismo viaje
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Zona / rango</th>
              <th className="px-4 py-2.5">Distancia</th>
              <th className="px-4 py-2.5">Corredor</th>
              <th className="px-4 py-2.5 text-right">Órdenes</th>
              <th className="px-4 py-2.5 text-right">Puertas</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <FragmentRows key={z.id}>
                {/* Cabecera del rango: el total. Debajo, una fila por lado --
                    que es la tanda que de verdad se puede armar en un dia. */}
                <tr className="border-t border-slate-200 bg-slate-50/70">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: z.color }}
                      />
                      <span>
                        <span className="font-semibold text-slate-800">{z.name}</span>
                        {z.short_name && (
                          <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            {z.short_name}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                    {z.max_miles
                      ? `${fmtNum(z.min_miles)} – ${fmtNum(z.max_miles)} mi`
                      : `${fmtNum(z.min_miles)}+ mi`}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">
                    {z.directions.length > 1
                      ? `${z.directions.length} corredores`
                      : z.directions.length === 1
                        ? "1 corredor"
                        : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500">
                    {z.orders}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold text-slate-800">
                    {z.doors}
                  </td>
                </tr>
                {z.directions.map((d) => (
                  <tr key={`${z.id}-${d.code}`} className="border-t border-slate-100">
                    <td className="py-2 pl-11 pr-4 text-xs text-slate-400">↳</td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 text-sm font-medium text-slate-700">
                      <span className="flex flex-col">
                        <span>{CORRIDOR_LABEL[d.code] ?? d.code}</span>
                        <span className="text-[10px] font-normal text-slate-400">
                          {CORRIDOR_HINT[d.code] ?? ""}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">
                      {d.orders}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-sm font-semibold text-slate-700">
                      {d.doors}
                    </td>
                  </tr>
                ))}
              </FragmentRows>
            ))}
            {/* Nunca se esconden las que no se pudieron ubicar: si desaparecen,
                el total deja de cuadrar con el resto del tablero y nadie sabe
                por que. Casi siempre es una direccion sin codigo postal. */}
            {!!unlocated?.orders && (
              <tr className="border-t border-slate-100 bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-300" />
                    <span>
                      <span className="font-semibold text-slate-600">Sin ubicar</span>
                      <span className="block text-[10px] text-slate-400">
                        Falta el código postal en la dirección
                      </span>
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-400">—</td>
                <td className="px-4 py-2.5 text-xs text-slate-400">—</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500">
                  {unlocated.orders}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold text-slate-600">
                  {unlocated.doors}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TabChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition",
        active
          ? "border-b-2 border-indigo-700 text-indigo-700"
          : "text-slate-500 hover:text-slate-700",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-[10px] font-bold",
          active ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function RangePreset({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
    >
      {children}
    </button>
  );
}

function StatusPill({
  status,
  stageCode,
}: {
  status: "installed" | "scheduled" | "pending";
  stageCode?: string;
}) {
  // Prefer the REAL pipeline stage so office can tell an already-invoiced or
  // closed order apart from one that's merely installed — otherwise they all
  // read "Installed" and look identical while invoicing. Falls back to the
  // install-workflow status for stages we don't special-case here.
  const stageMap: Record<string, { bg: string; text: string; label: string }> = {
    invoiced: { bg: "bg-indigo-50", text: "text-indigo-700", label: "Invoiced" },
    closed: { bg: "bg-slate-200", text: "text-slate-700", label: "Closed" },
  };
  const statusMap = {
    installed: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Installed" },
    scheduled: { bg: "bg-sky-50", text: "text-sky-700", label: "Scheduled" },
    pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pending" },
  };
  const cfg = (stageCode && stageMap[stageCode]) || statusMap[status];
  return (
    <Badge
      variant="secondary"
      className={cn("text-[10px] font-bold uppercase tracking-wide", cfg.bg, cfg.text)}
    >
      {cfg.label}
    </Badge>
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
    // Compacta en el telefono. Estas seis tarjetas median 230 px cada una en
    // 390 px de ancho -- el icono de 48 px al lado del texto obligaba a que
    // "Doors to Install" y "Pending - Client" partieran en dos lineas, y la
    // pista de abajo en otras dos. Seiscientos y pico pixeles de scroll antes
    // de ver una sola instalacion.
    <div className="rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-slate-100 sm:p-4">
      <div className="flex items-center gap-2 sm:items-start sm:gap-3">
        <span
          className={cn(
            "flex h-9 w-9 flex-none items-center justify-center rounded-lg sm:h-12 sm:w-12 sm:rounded-xl",
            iconBg,
          )}
        >
          <Icon size={16} className={cn(iconColor, "sm:hidden")} />
          <Icon size={20} className={cn(iconColor, "hidden sm:block")} />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-medium leading-tight text-slate-500 sm:text-xs">
            {label}
          </div>
          <div className="text-xl font-bold leading-tight text-slate-900 sm:mt-0.5 sm:text-2xl">
            {value}
          </div>
          {/* La pista ("IN QUEUE", "ON CALENDAR") repite lo que ya dice la
              etiqueta. En un monitor decora; en un telefono cuesta dos lineas
              por tarjeta. Se oculta, no se borra. */}
          <div className="hidden text-[10px] uppercase tracking-wide text-slate-400 sm:block">
            {hint}
          </div>
        </div>
      </div>
    </div>
  );
}

// Section theme per hold cause — dealer = blue, client = orange, Majela's
// own words (2026-08-15 audio). Kept distinct from the top counter chips'
// classes so the two never drift apart by accident.
const HOLD_SECTION_THEME: Record<
  "dealer" | "client" | "other",
  {
    section: string;
    headerBorder: string;
    headerText: string;
    badgeBg: string;
    badgeText: string;
    theadBg: string;
    theadText: string;
    rowBorder: string;
    rowHover: string;
  }
> = {
  dealer: {
    section: "border-sky-200 bg-sky-50/50",
    headerBorder: "border-sky-200",
    headerText: "text-sky-900",
    badgeBg: "bg-sky-200",
    badgeText: "text-sky-800",
    theadBg: "bg-sky-100/60",
    theadText: "text-sky-800",
    rowBorder: "border-sky-100",
    rowHover: "hover:bg-sky-100/40",
  },
  client: {
    section: "border-orange-200 bg-orange-50/50",
    headerBorder: "border-orange-200",
    headerText: "text-orange-900",
    badgeBg: "bg-orange-200",
    badgeText: "text-orange-800",
    theadBg: "bg-orange-100/60",
    theadText: "text-orange-800",
    rowBorder: "border-orange-100",
    rowHover: "hover:bg-orange-100/40",
  },
  other: {
    section: "border-slate-200 bg-slate-50",
    headerBorder: "border-slate-200",
    headerText: "text-slate-700",
    badgeBg: "bg-slate-200",
    badgeText: "text-slate-700",
    theadBg: "bg-slate-100",
    theadText: "text-slate-600",
    rowBorder: "border-slate-100",
    rowHover: "hover:bg-slate-100/60",
  },
};

/**
 * One "blocked doors" panel for a single hold cause — the two-panel shape
 * from Majela's own mockup (ON HOLD – DEALER / PENDING – CLIENT), each with
 * its own door count and a per-row reason. Color is never the only signal:
 * the section title and every badge carry a text label too, so this still
 * reads correctly for someone who can't easily tell blue from orange apart.
 */
/** Cuantas filas entran en una tarjeta de un tercio de ancho sin que haya
 *  que hacer scroll dentro de ella. Si hay mas, se dicen cuantas quedan. */
const HOLD_CARD_ROWS = 5;

/**
 * Version resumida de un panel de espera, para la fila de tres columnas.
 *
 * Muestra lo justo para reconocer una orden y decidir: quien es, donde, y
 * por que esta trabada. Lo demas (tipo de puerta, cantidad, instalador,
 * boton de liberar) vive en el detalle completo, que se abre con "Ver
 * todas" -- meterlo aca haria que ninguna de las tres columnas entrara.
 */
function HoldSummaryCard({
  icon: Icon,
  title,
  subtitle,
  theme,
  rows,
  doorCount,
  expanded,
  onToggle,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle: string;
  theme: (typeof HOLD_SECTION_THEME)[keyof typeof HOLD_SECTION_THEME];
  rows: DashboardData["onHold"]["dealer"]["orders"];
  doorCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const shown = rows.slice(0, HOLD_CARD_ROWS);
  return (
    <section className={cn("flex flex-col overflow-hidden rounded-2xl border shadow-sm", theme.section)}>
      <div className={cn("flex items-start justify-between gap-2 border-b px-4 py-3", theme.headerBorder)}>
        <div>
          <h3 className={cn("flex items-center gap-1.5 text-sm font-semibold", theme.headerText)}>
            <Icon size={14} />
            {title}
          </h3>
          <p className={cn("mt-0.5 text-xs opacity-80", theme.headerText)}>{subtitle}</p>
        </div>
        <Badge
          variant="secondary"
          className={cn("shrink-0 text-[10px] font-bold", theme.badgeBg, theme.badgeText)}
        >
          {doorCount} {doorCount === 1 ? "puerta" : "puertas"}
        </Badge>
      </div>

      {rows.length === 0 ? (
        // Un vacio explicito, no una tarjeta en blanco: "no hay ninguna" es
        // una respuesta util cuando la pregunta es "a quien tengo que llamar".
        <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-xs text-slate-400">
          Ninguna orden trabada por esta causa.
        </div>
      ) : (
        <div className="flex-1">
          <table className="w-full text-sm">
            <tbody>
              {shown.map((o) => (
                <tr key={o.id} className={cn("border-t align-top", theme.rowBorder, theme.rowHover)}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/orders/${o.id}`}
                      className="font-mono text-[11px] font-semibold text-indigo-700 hover:underline"
                      title={o.name}
                    >
                      {o.dealer_ref || o.name}
                    </Link>
                    <span className="mt-0.5 block truncate text-xs font-medium text-slate-700">
                      {o.client_name}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {o.client_address || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {o.hold_reason ? (
                      <span
                        className={cn(
                          "inline-block max-w-[10rem] truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                          theme.badgeBg,
                          theme.badgeText,
                        )}
                        title={o.hold_reason}
                      >
                        {o.hold_reason}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">sin motivo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        onClick={onToggle}
        disabled={rows.length === 0}
        className={cn(
          "flex items-center justify-center gap-1.5 border-t px-4 py-2.5 text-xs font-semibold transition",
          theme.headerBorder,
          rows.length === 0
            ? "cursor-default text-slate-300"
            : cn(theme.headerText, "hover:opacity-75"),
        )}
      >
        {expanded ? "Ocultar el detalle" : `Ver todas (${rows.length})`}
        <ArrowRight size={13} className={cn("transition", expanded && "rotate-90")} />
      </button>
    </section>
  );
}

function HoldSection({
  icon: Icon,
  title,
  subtitle,
  theme,
  rows,
  onRelease,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle: string;
  theme: (typeof HOLD_SECTION_THEME)[keyof typeof HOLD_SECTION_THEME];
  rows: DashboardData["onHold"]["dealer"]["orders"];
  onRelease: (order: DashboardData["onHold"]["dealer"]["orders"][number]) => void;
}) {
  if (!rows.length) return null;
  return (
    <section className={cn("overflow-hidden rounded-2xl border shadow-sm", theme.section)}>
      <div className={cn("flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3", theme.headerBorder)}>
        <h3 className={cn("flex items-center gap-1.5 font-semibold", theme.headerText)}>
          <Icon size={15} />
          {title}
          <Badge variant="secondary" className={cn("text-[10px] font-bold", theme.badgeBg, theme.badgeText)}>
            {rows.length}
          </Badge>
        </h3>
        <span className={cn("text-xs", theme.headerText)}>{subtitle}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className={cn("text-left text-[10px] font-bold uppercase tracking-wide", theme.theadBg, theme.theadText)}>
            <tr>
              <th className="px-4 py-2.5">Order Number</th>
              <th className="px-4 py-2.5">Client Name</th>
              <th className="px-4 py-2.5">Address</th>
              <th className="px-4 py-2.5">Reason</th>
              <th className="px-4 py-2.5">Door Type</th>
              <th className="px-4 py-2.5 text-right">Qty</th>
              <th className="px-4 py-2.5">Installer</th>
              <th className="px-4 py-2.5 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className={cn("border-t transition", theme.rowBorder, theme.rowHover)}>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/orders/${o.id}`}
                    className="font-mono text-xs font-semibold text-indigo-700 hover:underline"
                    title={o.name}
                  >
                    {o.dealer_ref || o.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-slate-700">{o.client_name}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600">{o.client_address || "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600">{o.hold_reason || "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-700">
                  {DOOR_TYPE_LABEL[o.door_type] ?? o.door_type ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{o.door_count}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600">{o.installer}</td>
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => onRelease(o)}
                    className="inline-flex h-7 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white transition hover:bg-emerald-700"
                  >
                    <Play size={11} /> Release
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}
