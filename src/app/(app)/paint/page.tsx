"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Download,
  Printer,
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
import { fmtMoney, fmtNum } from "@/lib/utils";
import { toCsv, downloadCsv } from "@/lib/csv";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";

const PAINT_RATE = 8;

interface PaintRow {
  id: number;
  name: string;
  dealer_id: [number, string] | false;
  dealer_ref: string;
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

const COLOR_LABEL: Record<string, string> = {
  white: "white",
  bronze: "bronze",
  bronze_eco: "bronze ECO",
  black: "black",
};

const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "SD",
  DD: "DD",
  SDL: "SDL",
};

export default function PaintPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

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

  const rows = data?.records ?? [];
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
    const ids = Array.from(selected);
    if (!ids.length) return;
    const readyStage = stagesQ.data?.records?.find(
      (s) => s.code === "ready_install",
    );
    if (!readyStage) {
      toast.error(
        "Stage 'Ready for Installation' not found. Reload the page and try again.",
      );
      return;
    }
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
                { header: "Order Number", value: (r) => r.dealer_ref || "" },
                { header: "Client Name", value: (r) => r.client_name },
                { header: "Color", value: (r) => r.first_line?.color ?? "" },
                { header: "Door Type", value: (r) => r.first_line?.door_type ?? "" },
                { header: "SQF", value: (r) => r.total_sqf },
                {
                  header: "Lados de la Puerta",
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
                className="bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700"
              >
                <CheckSquare size={12} />
                Mark Received → Ready for Install
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
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Order Number</th>
                <th className="px-4 py-3">Client Name</th>
                <th className="px-4 py-3">Color</th>
                <th className="px-4 py-3">Door Type</th>
                <th className="px-4 py-3 text-right">SQF</th>
                <th className="px-4 py-3 text-center">Lados de la Puerta</th>
                <th className="px-4 py-3 text-right">Price (USD) / SQF</th>
                <th className="px-4 py-3 text-right">Total (USD)</th>
                <th className="px-4 py-3 text-center w-24">Design Preview</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={12} className="p-12 text-center text-slate-400">
                    Loading...
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-12 text-center text-slate-400">
                    No orders in painting stage
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const designId =
                  r.first_line?.design_id &&
                  Array.isArray(r.first_line.design_id)
                    ? r.first_line.design_id[0]
                    : null;
                const company =
                  (r.dealer_id && Array.isArray(r.dealer_id) && r.dealer_id[1]) ||
                  "—";
                const colorKey = r.first_line?.color ?? "";
                const colorLabel = COLOR_LABEL[colorKey] ?? colorKey ?? "—";
                const doorType = r.first_line?.door_type ?? "—";
                const doorTypeLabel =
                  DOOR_TYPE_LABEL[doorType] ?? doorType;
                const sides = r.first_line?.paint_sides ?? 2;
                const total = (r.total_sqf || 0) * PAINT_RATE;
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
                    <td className="px-4 py-3 font-semibold uppercase tracking-wide text-slate-700">
                      {company}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.dealer_ref || "—"}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/orders/${r.id}`}
                        className="text-slate-800 hover:text-indigo-700 hover:underline"
                      >
                        {r.client_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-700">
                      {colorLabel}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">
                      {doorTypeLabel}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {r.total_sqf?.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-semibold text-indigo-700">
                      {sides}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      ${PAINT_RATE.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-700">
                      {fmtMoney(total)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-md bg-slate-50 ring-1 ring-slate-200">
                        {designId ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={`/api/catalog/designs/${designId}/image`}
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
