"use client";

import { useState, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Download,
  Printer,
  FileText,
  Search,
  Settings,
  Info,
  X,
  CheckSquare,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MobileCardList, MobileRowCard } from "@/components/mobile-row-card";
import { BulkSendToButton } from "@/components/bulk-send-to-button";
import { QuickStageActionButton } from "@/components/quick-stage-action-button";
import { ColumnsMenu } from "@/components/columns-menu";
import { TableRowsSkeleton } from "@/components/skeleton";
import { useColumnPrefs, sortRows } from "@/hooks/use-table-prefs";
import { printTable } from "@/lib/print-table";
import { fmtMoney, fmtNum } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { colorLabel, doorTypeLabel } from "@/lib/labels";
import { toCsv, downloadCsv } from "@/lib/csv";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";
import { PAINT_SHOP_LABEL, PAINT_STAGE_OF_SHOP, type PaintShop } from "@/lib/stages";
import { cn } from "@/lib/utils";
import { deriveRole } from "@/lib/odoo/types";


interface PaintRow {
  id: number;
  name: string;
  dealer_id: [number, string] | false;
  dealer_ref: string;
  customer_po: string;
  client_name: string;
  door_count: number;
  total_sqf: number;
  painter_id?: [number, string] | false;
  first_line?: {
    id: number;
    design_id: [number, string] | false;
    paint_sides?: number;
    door_type?: string;
    color?: string;
  } | null;
}

interface Stage {
  id: number;
  name: string;
  code: string;
  sequence: number;
}

const companyOf = (r: PaintRow) =>
  (r.dealer_id && Array.isArray(r.dealer_id) && r.dealer_id[1]) || "—";

// ----- Configurable columns for the Paint worksheet -----
interface PaintCol {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  cell: (r: PaintRow) => ReactNode;
  print: (r: PaintRow) => string;
  sortVal?: (r: PaintRow) => string | number;
}
// Fabrica en vez de constante: las columnas de precio dependen de la
// tarifa configurada, que se conoce recien despues del fetch.
const money2 = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const buildPaintColumns = (
  rateOf: (r: PaintRow) => number | null,
  painterCell: (r: PaintRow) => ReactNode,
): PaintCol[] => [
  {
    key: "company",
    label: "Company",
    cell: (r) => (
      <span className="font-semibold uppercase tracking-wide text-slate-700">{companyOf(r)}</span>
    ),
    print: (r) => String(companyOf(r)),
    sortVal: (r) => String(companyOf(r)).toLowerCase(),
  },
  {
    key: "refs",
    label: "Order Refs",
    cell: (r) => (
      <div className="space-y-0.5">
        {r.dealer_ref ? <div className="font-semibold text-slate-800">{r.dealer_ref}</div> : null}
        <div className={r.dealer_ref ? "text-xs text-slate-400" : "font-semibold text-slate-800"}>
          {r.name}
        </div>
        {r.customer_po ? (
          <div className="text-[10px] uppercase tracking-wide text-slate-400">PO: {r.customer_po}</div>
        ) : null}
      </div>
    ),
    print: (r) => [r.dealer_ref, r.name, r.customer_po ? `PO:${r.customer_po}` : ""].filter(Boolean).join(" / "),
    sortVal: (r) => (r.dealer_ref || r.name || "").toLowerCase(),
  },
  {
    key: "client",
    label: "Client Name",
    cell: (r) => (
      <Link href={`/orders/${r.id}`} className="font-medium text-slate-800 hover:text-indigo-700 hover:underline">
        {r.client_name}
      </Link>
    ),
    print: (r) => r.client_name,
    sortVal: (r) => (r.client_name || "").toLowerCase(),
  },
  {
    key: "color",
    label: "Color",
    cell: (r) => <span className="text-slate-700">{colorLabel(r.first_line?.color)}</span>,
    print: (r) => colorLabel(r.first_line?.color),
    sortVal: (r) => colorLabel(r.first_line?.color),
  },
  {
    key: "doorType",
    label: "Door Type",
    cell: (r) => <span className="text-slate-700">{doorTypeLabel(r.first_line?.door_type)}</span>,
    print: (r) => doorTypeLabel(r.first_line?.door_type),
    sortVal: (r) => doorTypeLabel(r.first_line?.door_type),
  },
  {
    // Quien la pinta. En la pestana de Indigo se elige aqui (Elio o Mandy):
    // su pago y el precio de la hoja salen de ese dato.
    key: "painter",
    label: "Painted by",
    cell: painterCell,
    print: (r) => (Array.isArray(r.painter_id) ? r.painter_id[1] : ""),
    sortVal: (r) => (Array.isArray(r.painter_id) ? r.painter_id[1] : "").toLowerCase(),
  },
  {
    key: "sqf",
    label: "SQF",
    align: "right",
    cell: (r) => <span className="font-mono">{r.total_sqf?.toFixed(2)}</span>,
    print: (r) => (r.total_sqf || 0).toFixed(2),
    sortVal: (r) => r.total_sqf || 0,
  },
  {
    key: "sides",
    label: "Door Sides",
    align: "center",
    cell: (r) => (
      <span className="font-mono font-semibold text-indigo-700">{r.first_line?.paint_sides ?? 2}</span>
    ),
    print: (r) => String(r.first_line?.paint_sides ?? 2),
    sortVal: (r) => r.first_line?.paint_sides ?? 2,
  },
  {
    key: "price",
    label: "Price (USD) / SQF",
    align: "right",
    cell: (r) => <span className="font-mono">{money2(rateOf(r))}</span>,
    print: (r) => (rateOf(r) == null ? "" : rateOf(r)!.toFixed(2)),
  },
  {
    key: "total",
    label: "Total (USD)",
    align: "right",
    cell: (r) => {
      const rate = rateOf(r);
      return (
        <span className="font-bold text-emerald-700">
          {rate == null ? "—" : fmtMoney((r.total_sqf || 0) * rate)}
        </span>
      );
    },
    print: (r) => (rateOf(r) == null ? "" : ((r.total_sqf || 0) * rateOf(r)!).toFixed(2)),
    sortVal: (r) => (r.total_sqf || 0) * (rateOf(r) ?? 0),
  },
  {
    key: "design",
    label: "Design Preview",
    align: "center",
    cell: (r) => {
      const designId =
        r.first_line?.design_id && Array.isArray(r.first_line.design_id) ? r.first_line.design_id[0] : null;
      return (
        <div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-md bg-slate-50 ring-1 ring-slate-200">
          {designId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/catalog/designs/${designId}/image?${new URLSearchParams({ ...(r.first_line?.color ? { color: r.first_line.color } : {}), ...(r.first_line?.door_type ? { type: r.first_line.door_type } : {}) }).toString()}`}
              alt="Design"
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span className="text-[10px] text-slate-300">—</span>
          )}
        </div>
      );
    },
    print: () => "",
  },
];
// Las claves no dependen de la tarifa; cualquier valor sirve para leerlas.
const PAINT_COL_DEFAULT = buildPaintColumns(() => 0, () => null).map((c) => c.key);
const PAINT_COLS_KEY = "indigo:paint-cols";

export default function PaintPage() {
  const qc = useQueryClient();
  // La tarifa del pintor sale de la configuracion, nunca de una constante:
  // si Majela la cambia en Settings, la hoja impresa tiene que cambiar con
  // ella. Solo se devuelven las reglas que a esta persona le corresponde
  // ver (ver /api/pay-rules).
  const payRulesQ = useQuery<{ rules: Array<{ contractorType: string; partnerId: number | null; ratePerDoor: number }> }>({
    queryKey: ["pay-rules"],
    queryFn: () => fetchJson("/api/pay-rules"),
  });
  // Quien puede elegir el pintor: oficina y gerencia (las mismas que la
  // ruta /assign acepta). Un pintor ve la hoja, no la edita.
  const meQ = useQuery<{ user: { isAdmin: boolean; groups: string[] } | null }>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then((r) => r.json()),
  });
  const role = meQ.data?.user ? deriveRole(meQ.data.user.groups) : null;
  const canAssign = !!(role?.isManager || role?.isOffice || meQ.data?.user?.isAdmin);

  // Dos etapas de pintura (2026-09-29): la pestana elige cual se ve.
  const [shop, setShop] = useState<PaintShop>("michel");
  const painterListQ = useQuery<{ painters: Array<{ id: number; name: string; shop?: PaintShop }> }>({
    queryKey: ["contractors"],
    queryFn: () => fetchJson("/api/contractors"),
    staleTime: 60_000,
  });
  const allPainters = painterListQ.data?.painters ?? [];
  const shopPainters = allPainters.filter((p) => p.shop === shop);
  const [assigning, setAssigning] = useState<Set<number>>(new Set());
  async function assignPainter(orderId: number, painterId: number | null) {
    setAssigning((prev) => new Set(prev).add(orderId));
    try {
      await fetchJson(`/api/orders/${orderId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ painter_id: painterId }),
      });
      await qc.invalidateQueries({ queryKey: ["paint"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't assign the painter");
    } finally {
      setAssigning((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  }

  // Tarifas: nunca un 0 inventado. Mientras cargan, o si fallan, el precio
  // es "—" (esta hoja es el papel con el que se le paga a alguien).
  const rulesReady = payRulesQ.isSuccess;
  const painterRules = (payRulesQ.data?.rules ?? []).filter((x) => x.contractorType === "painter");
  const generalRate = painterRules.find((x) => x.partnerId === null)?.ratePerDoor ?? null;
  const shopRate = (k: PaintShop): number | null => {
    const ids = new Set(allPainters.filter((p) => p.shop === k).map((p) => p.id));
    const rates = new Set(painterRules.filter((x) => x.partnerId != null && ids.has(x.partnerId)).map((x) => x.ratePerDoor));
    return rates.size === 1 ? [...rates][0] : null;
  };
  const michelRate = rulesReady ? (shopRate("michel") ?? generalRate) : null;
  // En Indigo, "tiene pintor" es tener a uno de los pintores de Indigo, no
  // cualquier pintor_id (uno de Michel puesto desde la ficha no vale).
  const isShopPainter = (r: PaintRow) =>
    Array.isArray(r.painter_id) && shopPainters.some((p) => p.id === (r.painter_id as [number, string])[0]);
  const needsPainter = (r: PaintRow) => shop === "indigo" && !isShopPainter(r);
  const rateOf = (r: PaintRow): number | null => {
    if (!rulesReady) return null;
    const pid = Array.isArray(r.painter_id) ? r.painter_id[0] : null;
    const own = pid != null ? painterRules.find((x) => x.partnerId === pid) : undefined;
    if (shop === "indigo") {
      if (isShopPainter(r) && own) return own.ratePerDoor;
      // Sin pintor de Indigo todavia: la tarifa del taller si es una sola.
      return canAssign ? shopRate("indigo") : null;
    }
    if (own) return own.ratePerDoor;
    return michelRate;
  };
  const painterCell = (r: PaintRow): ReactNode => {
    const current = Array.isArray(r.painter_id) ? r.painter_id : null;
    if (shop !== "indigo" || !canAssign) {
      return <span className="text-slate-700">{current ? current[1] : "—"}</span>;
    }
    const valid = isShopPainter(r);
    return (
      <div className="space-y-1">
        <select
          aria-label={`Who painted ${r.dealer_ref || r.name}`}
          value={valid && current ? current[0] : ""}
          disabled={assigning.has(r.id) || painterListQ.isLoading}
          onChange={(e) => assignPainter(r.id, e.target.value ? Number(e.target.value) : null)}
          className={cn(
            "h-10 rounded-lg border bg-white px-2 text-sm disabled:opacity-60",
            valid ? "border-slate-200 text-slate-800" : "border-amber-300 text-amber-800",
          )}
        >
          <option value="">Choose…</option>
          {shopPainters.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {current && !valid && (
          <div className="text-[11px] text-amber-700">{current[1]} doesn&apos;t paint at Indigo</div>
        )}
      </div>
    );
  };
  const PAINT_RATE = michelRate;
  const PAINT_COLUMNS = useMemo(
    () => buildPaintColumns(rateOf, painterCell),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shop, payRulesQ.data, rulesReady, painterListQ.data, painterListQ.isLoading, canAssign, assigning],
  );
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [marking, setMarking] = useState(false);

  const { colKeys, toggle: toggleCol } = useColumnPrefs(
    PAINT_COLS_KEY,
    PAINT_COL_DEFAULT,
    PAINT_COL_DEFAULT,
  );
  const visiblePaintCols = PAINT_COLUMNS.filter(
    (c) => colKeys.includes(c.key) || (c.key === "painter" && shop === "indigo"),
  );
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  function toggleSort(key: string) {
    const col = PAINT_COLUMNS.find((c) => c.key === key);
    if (!col?.sortVal) return;
    setSort((p) =>
      !p || p.key !== key ? { key, dir: "asc" } : p.dir === "asc" ? { key, dir: "desc" } : null,
    );
  }

  const { data, isLoading } = useQuery<{ records: PaintRow[]; total: number }>({
    queryKey: ["paint", shop, q],
    queryFn: () => {
      const url = new URL("/api/orders", window.location.origin);
      url.searchParams.set("stage", PAINT_STAGE_OF_SHOP[shop]);
      url.searchParams.set("include", "lines");
      url.searchParams.set("limit", "200");
      if (q) url.searchParams.set("q", q);
      return fetch(url).then((r) => r.json());
    },
  });

  // Cuantas puertas hay en la OTRA pestana, para su contador.
  const otherShop: PaintShop = shop === "michel" ? "indigo" : "michel";
  const otherQ = useQuery<{ total: number }>({
    queryKey: ["paint", "count", otherShop],
    queryFn: () => {
      const url = new URL("/api/orders", window.location.origin);
      url.searchParams.set("stage", PAINT_STAGE_OF_SHOP[otherShop]);
      url.searchParams.set("limit", "1");
      return fetch(url).then((r) => r.json());
    },
  });

  const stagesQ = useQuery<{ records: Stage[] }>({
    queryKey: ["stages-list"],
    queryFn: () => fetch("/api/stages").then((r) => r.json()),
    staleTime: 10 * 60_000,
  });

  const rows = useMemo(() => data?.records ?? [], [data]);
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = PAINT_COLUMNS.find((c) => c.key === sort.key);
    if (!col?.sortVal) return rows;
    return sortRows(rows, col.sortVal, sort.dir);
  }, [rows, sort, PAINT_COLUMNS]);
  const totalSqf = rows.reduce((s, r) => s + (r.total_sqf || 0), 0);
  const totalAmount = rows.reduce((s, r) => s + (r.total_sqf || 0) * (rateOf(r) ?? 0), 0);
  const unassigned = rows.filter(needsPainter);

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function markReceived() {
    if (marking) return;
    const ids = Array.from(selected);
    if (!ids.length) return;
    const missing = rows.filter((r) => selected.has(r.id) && needsPainter(r));
    if (missing.length) {
      toast.error(
        `Choose who painted ${missing.map((r) => r.dealer_ref || r.name).join(", ")} before marking ${missing.length === 1 ? "it" : "them"} received.`,
      );
      return;
    }
    // Resolve the target stage BEFORE flipping `marking` — otherwise an
    // early return here would leave the button stuck on "Marking…" forever.
    const readyStage = stagesQ.data?.records?.find(
      (s) => s.code === "ready_install",
    );
    if (!readyStage) {
      toast.error(
        "Stage 'Ready for Installation' not found. Reload the page and try again.",
      );
      return;
    }
    setMarking(true);
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/orders/${id}/stage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage_id: readyStage.id,
            note: "Picked up from paint shop",
            source: `Mark received (${ids.length})`,
          }),
        }).then(async (r) => {
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
          return j;
        }),
      ),
    );
    setMarking(false);
    qc.invalidateQueries({ queryKey: ["paint"] });
    const failed = results.filter((r) => r.status === "rejected").length;
    // El motivo real (el de Odoo), no solo cuantas fallaron.
    const reasons = [
      ...new Set(
        results.flatMap((r) =>
          r.status === "rejected" ? [r.reason instanceof Error ? r.reason.message : "Failed"] : [],
        ),
      ),
    ].slice(0, 2);
    if (failed === 0) {
      toast.success(`${ids.length} order${ids.length === 1 ? "" : "s"} marked received — moved to Ready for Installation`);
      clearSelection();
      return;
    }
    if (failed === ids.length) {
      toast.error(`All ${ids.length} updates failed: ${reasons.join(" · ")}`, { duration: 10000 });
      return;
    }
    toast.warning(
      `${ids.length - failed} of ${ids.length} moved. ${failed} failed: ${reasons.join(" · ")}`,
      { duration: 10000 },
    );
    clearSelection();
  }

  function printList() {
    if (!sortedRows.length) return toast.warning("Nothing to print");
    const cols = visiblePaintCols
      .filter((c) => c.key !== "design")
      .map((c) => ({
        label: c.label,
        align: (c.align === "right" ? "right" : "left") as "left" | "right",
        print: c.print,
      }));
    const ok = printTable({
      title: `Indigo Decors — Paint worksheet · ${PAINT_SHOP_LABEL[shop]}`,
      subtitle: `${sortedRows.length} order${sortedRows.length === 1 ? "" : "s"}${q ? ` · filter “${q}”` : ""} · Total SQF ${fmtNum(totalSqf)} · ${fmtMoney(totalAmount)}`,
      columns: cols,
      rows: sortedRows,
    });
    if (!ok) toast.error("Allow pop-ups to print the list");
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Paint
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {shop === "michel"
              ? `Michel's painting worksheet. SQF × ${PAINT_RATE == null ? "his rate" : `$${PAINT_RATE.toFixed(2)}`} per SQF.`
              : "Indigo's painting worksheet. Choose who painted each door: it sets the price per SQF."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={16}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            />
            <Input
              type="search"
              placeholder="Search by order, client or reference..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-10 w-72 pl-10"
            />
          </div>
          <ColumnsMenu
            columns={PAINT_COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
            visible={colKeys}
            onToggle={toggleCol}
            triggerClassName="inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none"
          />
          <Button variant="outline" size="lg" onClick={printList} disabled={!rulesReady}>
            <FileText size={14} /> Print list
          </Button>
          <Button
            size="lg"
            disabled={!rulesReady}
            className="bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700"
            onClick={() => {
              if (!rows.length) return toast.warning("Nothing to export");
              const csv = toCsv(rows.map((r, i) => ({ ...r, idx: i + 1 })), [
                { header: "#", value: (r) => (r as PaintRow & { idx: number }).idx },
                {
                  header: "Company",
                  value: (r) =>
                    (r.dealer_id && Array.isArray(r.dealer_id) && r.dealer_id[1]) || "",
                },
                { header: "Dealer Ref", value: (r) => r.dealer_ref || "" },
                { header: "Indigo Order #", value: (r) => r.name },
                { header: "Customer PO", value: (r) => r.customer_po || "" },
                { header: "Client Name", value: (r) => r.client_name },
                { header: "Color", value: (r) => r.first_line?.color ?? "" },
                { header: "Door Type", value: (r) => r.first_line?.door_type ?? "" },
                { header: "SQF", value: (r) => r.total_sqf },
                {
                  header: "Door Sides",
                  value: (r) => r.first_line?.paint_sides ?? 2,
                },
                { header: "Painted by", value: (r) => (Array.isArray(r.painter_id) ? r.painter_id[1] : "") },
                { header: "Price / SQF (USD)", value: (r) => rateOf(r) ?? "" },
                {
                  header: "Total (USD)",
                  value: (r) => (rateOf(r) == null ? "" : (r.total_sqf || 0) * rateOf(r)!),
                },
              ]);
              downloadCsv(
                `paint-sheet-${shop}-${new Date().toISOString().slice(0, 10)}.csv`,
                csv,
              );
              toast.success(`Exported ${rows.length} rows`);
            }}
          >
            <Download size={14} /> Export Excel
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              if (!rows.length) return toast.warning("Nothing to print");
              openOdooReport({
                report: REPORTS.painterSheet,
                ids: rows.map((r) => r.id),
                filename: `paint-sheet-${shop}-${new Date().toISOString().slice(0, 10)}.pdf`,
              });
            }}
          >
            <Printer size={14} /> Print / PDF
          </Button>
        </div>
      </header>

      {payRulesQ.isError && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="flex-1">Couldn&apos;t load the painters&apos; rates, so prices are hidden and the sheet can&apos;t be printed from here.</span>
          <Button size="sm" variant="outline" onClick={() => payRulesQ.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* Las dos etapas de pintura: Michel e Indigo. */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200" aria-label="Painting stage">
        {(["michel", "indigo"] as const).map((k) => {
          const count = k === shop ? rows.length : otherQ.data?.total;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={shop === k}
              onClick={() => {
                setShop(k);
                setSelected(new Set());
              }}
              className={cn(
                "inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition",
                shop === k ? "border-indigo-700 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              Painting – {PAINT_SHOP_LABEL[k]}
              {count != null && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[11px] tabular-nums",
                    shop === k ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-5 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-block rounded-xl bg-indigo-100 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-indigo-800">
            {shop === "michel"
              ? PAINT_RATE == null
                ? "Paint price: loading…"
                : `Paint price: $${PAINT_RATE.toFixed(2)} per SQF`
              : "Paint price: each painter's rate per SQF"}
          </span>
          {unassigned.length > 0 && (
            <span className="rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
              {unassigned.length} without painter — choose Elio or Mandy
            </span>
          )}
          {selected.size > 0 && (
            <>
              <Badge
                variant="secondary"
                className="bg-indigo-50 text-xs font-bold uppercase tracking-wide text-indigo-700"
              >
                {selected.size} selected
                <button
                  type="button"
                  onClick={clearSelection}
                  aria-label="Clear selection"
                  className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-indigo-100"
                >
                  <X size={10} />
                </button>
              </Badge>
              <Button
                size="sm"
                onClick={markReceived}
                disabled={marking}
                className="bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700 disabled:opacity-60"
              >
                <CheckSquare size={12} />
                {marking ? "Moving…" : "Mark Received → Ready for Install"}
              </Button>
              <BulkSendToButton
                orderIds={Array.from(selected)}
                stages={stagesQ.data?.records ?? []}
                onSuccess={() => {
                  clearSelection();
                  qc.invalidateQueries({ queryKey: ["paint"] });
                }}
              />
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span>
            <span className="text-slate-500">Total Orders: </span>
            <span className="font-bold text-slate-900">{fmtNum(rows.length)}</span>
          </span>
          <span>
            <span className="text-slate-500">Total SQF: </span>
            <span className="font-bold text-slate-900">{fmtNum(totalSqf)}</span>
          </span>
          <span className="rounded-xl bg-indigo-700 px-3 py-1.5 text-sm font-bold text-white shadow shadow-indigo-700/20">
            Total Amount: {fmtMoney(totalAmount)}
          </span>
        </div>
      </div>

      {/* Movil: una tarjeta por orden.
          La tabla mide 1200 px dentro de una ventana de 364 px, asi que el
          SQF, el color y el importe -- la hoja del pintor entera -- quedaban a
          tres pantallas de arrastre, con el boton de accion al final de todo.
          Aqui se lee de un vistazo y "Received" ocupa el ancho completo. */}
      <MobileCardList>
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        )}
        {!isLoading && sortedRows.length === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">
            No orders in painting stage
          </p>
        )}
        {!isLoading &&
          sortedRows.map((r) => (
            <MobileRowCard
              key={r.id}
              selected={selected.has(r.id)}
              onSelect={() => toggleOne(r.id)}
              selectLabel={`Select ${r.dealer_ref || r.name}`}
              title={
                <Link href={`/orders/${r.id}`} className="text-indigo-700 hover:underline">
                  {r.dealer_ref || r.name}
                </Link>
              }
              subtitle={
                [companyOf(r), r.client_name, r.customer_po ? `PO: ${r.customer_po}` : ""]
                  .filter(Boolean)
                  .join(" · ")
              }
              fields={[
                { label: "Color", value: colorLabel(r.first_line?.color) },
                { label: "Door type", value: doorTypeLabel(r.first_line?.door_type) },
                { label: "SQF", value: (r.total_sqf || 0).toFixed(2), strong: true },
                {
                  label: "Total",
                  value: rateOf(r) == null ? "—" : fmtMoney((r.total_sqf || 0) * rateOf(r)!),
                  strong: true,
                },
                { label: "Painted by", value: painterCell(r) },
                { label: "Sides", value: String(r.first_line?.paint_sides ?? 2) },
              ]}
              action={
                needsPainter(r) ? (
                  <span className="text-xs font-medium text-amber-700">Choose who painted it first</span>
                ) : (
                  <QuickStageActionButton
                    orderId={r.id}
                    targetStageCode="ready_install"
                    label="Received"
                    loadingVerb="Marking received"
                  />
                )
              }
            />
          ))}
      </MobileCardList>

      {/* Tabla: solo de tablet para arriba. Comparar veinte filas de un
          vistazo es lo que una tabla hace bien y una lista de tarjetas hace
          mal, asi que no se sustituye, conviven. */}
      <div className="hidden overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm md:block">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3 w-10">
                  <Checkbox
                    checked={
                      rows.length > 0 && selected.size === rows.length
                    }
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-3 w-8">#</th>
                {visiblePaintCols.map((c) => (
                  <th
                    key={c.key}
                    className={`px-4 py-3 ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""}`}
                  >
                    {c.sortVal ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-900"
                      >
                        {c.label}
                        {sort?.key === c.key && <span>{sort.dir === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
                <th className="px-4 py-3 text-center w-32">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableRowsSkeleton rows={6} cols={3 + visiblePaintCols.length} />}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={3 + visiblePaintCols.length} className="p-12 text-center text-slate-400">
                    No orders in painting stage
                  </td>
                </tr>
              )}
              {sortedRows.map((r, i) => {
                const isSelected = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    className={`border-t border-slate-100 transition hover:bg-slate-50 ${
                      isSelected ? "bg-indigo-50/40" : ""
                    }`}
                  >
                    <td className="px-3 py-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleOne(r.id)}
                        aria-label={`Select ${r.dealer_ref || r.name}`}
                      />
                    </td>
                    <td className="px-3 py-3 text-slate-400">{i + 1}</td>
                    {visiblePaintCols.map((c) => (
                      <td
                        key={c.key}
                        className={`px-4 py-3 ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""}`}
                      >
                        {c.cell(r)}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center">
                      {needsPainter(r) ? (
                        <span className="text-xs font-medium text-amber-700">Choose painter</span>
                      ) : (
                        <QuickStageActionButton
                          orderId={r.id}
                          targetStageCode="ready_install"
                          label="Received"
                          loadingVerb="Marking received"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-3 text-xs text-slate-600">
          <span>
            Showing <strong>1</strong> to <strong>{rows.length}</strong> of{" "}
            <strong>{rows.length}</strong> orders
          </span>
          <div className="flex items-center gap-4">
            <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm">
              <span className="text-slate-500">Total SQF: </span>
              <span className="font-bold text-slate-900">{fmtNum(totalSqf)}</span>
            </span>
            <span className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-bold text-white">
              Total Amount: {fmtMoney(totalAmount)}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom note */}
      <div className="flex items-center justify-center gap-2 py-3 text-xs text-slate-500">
        <Info size={14} className="text-indigo-500" />
        Price per SQF can be configured in{" "}
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline"
        >
          <Settings size={12} /> Settings
        </Link>
      </div>
    </div>
  );
}
