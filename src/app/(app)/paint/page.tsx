"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Download, Printer, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmtMoney, fmtNum, m2o } from "@/lib/utils";
import { toCsv, downloadCsv } from "@/lib/csv";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PaintRow {
  id: number;
  name: string;
  dealer_id: [number, string] | false;
  client_name: string;
  door_count: number;
  total_sqf: number;
  total_painter_payout: number;
}

const PAINT_RATE = 8;

export default function PaintPage() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery<{ records: PaintRow[] }>({
    queryKey: ["paint", q],
    queryFn: () =>
      fetch(`/api/orders?stage=painting${q ? `&q=${encodeURIComponent(q)}` : ""}`).then((r) =>
        r.json(),
      ),
  });

  const rows = data?.records ?? [];
  const totalSqf = rows.reduce((s, r) => s + (r.total_sqf || 0), 0);
  const totalAmount = totalSqf * PAINT_RATE;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Paint
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Painting worksheet. SQF × ${PAINT_RATE.toFixed(2)} per SQF.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => {
              if (!rows.length) return toast.warning("Nothing to export");
              const csv = toCsv(rows, [
                { header: "Company", value: (r) => m2o(r.dealer_id)?.name ?? "" },
                { header: "Order #", value: (r) => r.name },
                { header: "Client", value: (r) => r.client_name },
                { header: "Doors", value: (r) => r.door_count },
                { header: "SQF", value: (r) => r.total_sqf },
                { header: "Price / SQF", value: () => PAINT_RATE },
                { header: "Total (USD)", value: (r) => (r.total_sqf || 0) * PAINT_RATE },
              ]);
              downloadCsv(`paint-sheet-${new Date().toISOString().slice(0, 10)}.csv`, csv);
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
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm sm:gap-4 sm:px-5">
        <span className="inline-block rounded-xl bg-indigo-700 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white sm:text-xs">
          Paint price: ${PAINT_RATE.toFixed(2)} per SQF
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:ml-auto">
          <span>
            <span className="text-slate-500">Total Orders: </span>
            <span className="font-bold text-slate-900">{fmtNum(rows.length)}</span>
          </span>
          <span>
            <span className="text-slate-500">Total SQF: </span>
            <span className="font-bold text-slate-900">{fmtNum(totalSqf)}</span>
          </span>
        </div>
        <span className="w-full rounded-xl bg-indigo-700 px-3 py-1.5 text-center text-sm font-bold text-white sm:w-auto">
          Total Amount: {fmtMoney(totalAmount)}
        </span>
      </div>

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
          className="pl-10"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Order #</th>
              <th className="px-4 py-3">Client Name</th>
              <th className="px-4 py-3 text-right">SQF</th>
              <th className="px-4 py-3 text-right">Sides</th>
              <th className="px-4 py-3 text-right">Price / SQF</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="p-12 text-center text-slate-400">
                  Loading...
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-12 text-center text-slate-400">
                  No orders in painting stage
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr
                key={r.id}
                className="border-t border-slate-100 transition hover:bg-slate-50"
              >
                <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                <td className="px-4 py-3 font-medium uppercase">
                  {m2o(r.dealer_id)?.name ?? "—"}
                </td>
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/orders/${r.id}`}
                    className="text-indigo-700 hover:underline"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{r.client_name}</td>
                <td className="px-4 py-3 text-right font-mono">
                  {r.total_sqf?.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right">2</td>
                <td className="px-4 py-3 text-right">${PAINT_RATE.toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-bold text-emerald-700">
                  {fmtMoney((r.total_sqf || 0) * PAINT_RATE)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td colSpan={4} className="px-4 py-3 text-right font-semibold">
                Totals
              </td>
              <td className="px-4 py-3 text-right font-bold">
                {fmtNum(totalSqf)}
              </td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-right font-bold text-emerald-700">
                {fmtMoney(totalAmount)}
              </td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
    </div>
  );
}
