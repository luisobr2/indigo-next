"use client";

import { useState, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Download,
  Printer,
  FileText,
  Filter,
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
import { BulkSendToButton } from "@/components/bulk-send-to-button";
import { QuickStageActionButton } from "@/components/quick-stage-action-button";
import { ColumnsMenu } from "@/components/columns-menu";
import { useColumnPrefs, sortRows } from "@/hooks/use-table-prefs";
import { printTable } from "@/lib/print-table";
import { fmtMoney, fmtNum } from "@/lib/utils";
import { colorLabel, doorTypeLabel } from "@/lib/labels";
import { toCsv, downloadCsv } from "@/lib/csv";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";

const PAINT_RATE = 8;

interface PaintRow {
  id: number;
  name: string;
  dealer_id: [number, string] | false;
  dealer_ref: string;
  customer_po: string;
  client_name: string;
  door_count: number;
  total_sqf: number;
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
const PAINT_COLUMNS: PaintCol[] = [
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
    cell: () => <span className="font-mono">${PAINT_RATE.toFixed(2)}</span>,
    print: () => PAINT_RATE.toFixed(2),
  },
  {
    key: "total",
    label: "Total (USD)",
    align: "right",
    cell: (r) => (
      <span className="font-bold text-emerald-700">{fmtMoney((r.total_sqf || 0) * PAINT_RATE)}</span>
    ),
    print: (r) => ((r.total_sqf || 0) * PAINT_RATE).toFixed(2),
    sortVal: (r) => (r.total_sqf || 0) * PAINT_RATE,
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
const PAINT_COL_DEFAULT = PAINT_COLUMNS.map((c) => c.key);
const PAINT_COLS_KEY = "indigo:paint-cols";

export default function PaintPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [marking, setMarking] = useState(false);

  const { colKeys, toggle: toggleCol } = useColumnPrefs(
    PAINT_COLS_KEY,
    PAINT_COL_DEFAULT,
    PAINT_COL_DEFAULT,
  );
  const visiblePaintCols = PAINT_COLUMNS.filter((c) => colKeys.includes(c.key));
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  function toggleSort(key: string) {
    const col = PAINT_COLUMNS.find((c) => c.key === key);
    if (!col?.sortVal) return;
    setSort((p) =>
      !p || p.key !== key ? { key, dir: "asc" } : p.dir === "asc" ? { key, dir: "desc" } : null,
    );
  }

  const { data, isLoading } = useQuery<{ records: PaintRow[]; total: number }>({
    queryKey: ["paint", q],
    queryFn: () => {
      const url = new URL("/api/orders", window.location.origin);
      url.searchParams.set("stage", "painting");
      url.searchParams.set("include", "lines");
      url.searchParams.set("limit", "200");
      if (q) url.searchParams.set("q", q);
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
  }, [rows, sort]);
  const totalSqf = rows.reduce((s, r) => s + (r.total_sqf || 0), 0);
  const totalAmount = totalSqf * PAINT_RATE;

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
    if (failed === 0) {
      toast.success(`${ids.length} order${ids.length === 1 ? "" : "s"} marked received — moved to Ready for Installation`);
      clearSelection();
      return;
    }
    if (failed === ids.length) {
      toast.error(`All ${ids.length} updates failed.`);
      return;
    }
    toast.warning(
      `${ids.length - failed} of ${ids.length} moved. ${failed} failed — check their chatter.`,
      { duration: 8000 },
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
      title: "Indigo Decors — Paint worksheet",
      subtitle: `${sortedRows.length} order${sortedRows.length === 1 ? "" : "s"}${q ? ` · filter “${q}”` : ""} · Total SQF ${fmtNum(totalSqf)} · ${fmtMoney(totalAmount)}`,
      columns: cols,
      rows: sortedRows,
    });
    if (!ok) toast.error("Allow pop-ups to print the list");
  }

  return (
    <div className="mx-auto max-w-[1700px] space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Paint
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Painting worksheet. SQF × ${PAINT_RATE.toFixed(2)} per SQF.
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
          <Button variant="outline" size="lg" onClick={printList}>
            <FileText size={14} /> Print list
          </Button>
          <Button
            size="lg"
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
                { header: "Price / SQF (USD)", value: () => PAINT_RATE },
                {
                  header: "Total (USD)",
                  value: (r) => (r.total_sqf || 0) * PAINT_RATE,
                },
              ]);
              downloadCsv(
                `paint-sheet-${new Date().toISOString().slice(0, 10)}.csv`,
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
                filename: `paint-sheet-${new Date().toISOString().slice(0, 10)}.pdf`,
              });
            }}
          >
            <Printer size={14} /> Print / PDF
          </Button>
          <Button size="lg">
            <Filter size={14} /> Filters
          </Button>
        </div>
      </header>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-5 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-block rounded-xl bg-indigo-100 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-indigo-800">
            Paint price: ${PAINT_RATE.toFixed(2)} per SQF
          </span>
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

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1200px] text-sm">
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
              {isLoading && (
                <tr>
                  <td colSpan={3 + visiblePaintCols.length} className="p-12 text-center text-slate-400">
                    Loading...
                  </td>
                </tr>
              )}
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
                      <QuickStageActionButton
                        orderId={r.id}
                        targetStageCode="ready_install"
                        label="Received"
                        loadingVerb="Marking received"
                      />
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
