"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Search,
  Download,
  Printer,
  AlertCircle,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { fmtDate, fmtMoney, fmtNum, m2o } from "@/lib/utils";
import { TableSkeleton } from "@/components/skeleton";
import { EmptyState } from "@/components/state-cards";
import { toCsv, downloadCsv } from "@/lib/csv";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/pagination";

interface OrderRow {
  id: number;
  name: string;
  dealer_id: [number, string] | false;
  client_name: string;
  client_address: string;
  stage_id: [number, string] | false;
  stage_code: string;
  on_hold: boolean;
  payment_state: "unpaid" | "partial" | "paid";
  door_count: number;
  total_sqf: number;
  total_dealer_charge: number;
  is_overdue: boolean;
  days_in_current_stage: number;
  installation_date: string | false;
  create_date: string;
}

const STAGE_BADGE: Record<string, string> = {
  new: "bg-slate-100 text-slate-700",
  design_pending: "bg-amber-50 text-amber-700",
  design_confirmed: "bg-emerald-50 text-emerald-700",
  measure_pending: "bg-amber-50 text-amber-700",
  measured: "bg-emerald-50 text-emerald-700",
  ready_digitalization: "bg-sky-50 text-sky-700",
  cnc: "bg-violet-50 text-violet-700",
  painting: "bg-orange-50 text-orange-700",
  ready_install: "bg-blue-50 text-blue-700",
  install_scheduled: "bg-blue-50 text-blue-700",
  installed: "bg-emerald-50 text-emerald-700",
  invoiced: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-500",
};

const PAY_BADGE: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-700",
  unpaid: "bg-rose-50 text-rose-700",
};

function OrdersInner() {
  const sp = useSearchParams();
  const stage = sp.get("stage");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  // Debounce the search so typing doesn't fire a request per keystroke,
  // and reset to page 0 whenever the filter changes.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Stage filter via URL param: reset to first page when it changes.
  useEffect(() => {
    setPage(0);
  }, [stage]);

  const { data, isLoading } = useQuery<{
    records: OrderRow[];
    total: number;
  }>({
    queryKey: ["orders", stage, debouncedQ, page, pageSize],
    queryFn: async () => {
      const url = new URL("/api/orders", window.location.origin);
      if (stage) url.searchParams.set("stage", stage);
      if (debouncedQ) url.searchParams.set("q", debouncedQ);
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(page * pageSize));
      const r = await fetch(url);
      return r.json();
    },
    placeholderData: (prev) => prev, // keep the table painted while paging
  });

  const total = data?.total ?? 0;
  const records = useMemo(() => data?.records ?? [], [data]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Orders {stage && <span className="text-slate-500">— {stage}</span>}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {fmtNum(total)} order{total === 1 ? "" : "s"} found
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              if (!records.length) {
                toast.warning("No orders to export");
                return;
              }
              const csv = toCsv(records, [
                { header: "Order #", value: (r) => r.name },
                { header: "Client", value: (r) => r.client_name },
                { header: "Dealer", value: (r) => m2o(r.dealer_id)?.name ?? "" },
                { header: "Reference", value: (r) => r.client_address?.replace(/\n/g, " ") ?? "" },
                { header: "Doors", value: (r) => r.door_count },
                { header: "SQF", value: (r) => r.total_sqf },
                { header: "Total (USD)", value: (r) => r.total_dealer_charge },
                { header: "Stage", value: (r) => m2o(r.stage_id)?.name ?? "" },
                { header: "Payment", value: (r) => r.payment_state },
                { header: "Created", value: (r) => fmtDate(r.create_date) },
              ]);
              downloadCsv(`indigo-orders-${new Date().toISOString().slice(0, 10)}.csv`, csv);
              toast.success(`Exported ${records.length} orders`);
            }}
          >
            <Download size={14} />
            Export
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              if (!records.length) {
                toast.warning("No orders to print");
                return;
              }
              openOdooReport({
                report: REPORTS.orderCard,
                ids: records.map((r) => r.id),
                filename: `orders-${new Date().toISOString().slice(0, 10)}.pdf`,
              });
            }}
          >
            <Printer size={14} />
            Print / PDF
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
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
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Order #</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Dealer</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3 text-right">Doors</th>
              <th className="px-4 py-3 text-right">SQF</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Payment</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="p-0">
                  <TableSkeleton rows={6} cols={9} />
                </td>
              </tr>
            )}
            {!isLoading && records.length === 0 && (
              <tr>
                <td colSpan={9} className="p-0">
                  <EmptyState
                    title="No orders match"
                    message="Try clearing filters or searching by client name."
                  />
                </td>
              </tr>
            )}
            {records.map((r) => {
              const dealer = m2o(r.dealer_id);
              return (
                <tr
                  key={r.id}
                  className="border-t border-slate-100 transition hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/orders/${r.id}`}
                      className="flex items-center gap-1.5 text-indigo-700 hover:underline"
                    >
                      {r.name}
                      {r.is_overdue && (
                        <AlertCircle size={12} className="text-rose-500" />
                      )}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {fmtDate(r.create_date)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">
                      {r.client_name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {dealer?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    <div className="line-clamp-2 max-w-[260px]">
                      {r.client_address}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">{r.door_count}</td>
                  <td className="px-4 py-3 text-right">{fmtNum(r.total_sqf)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">
                    {fmtMoney(r.total_dealer_charge)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="secondary"
                      className={`text-[10px] font-bold uppercase tracking-wide ${
                        STAGE_BADGE[r.stage_code] ?? "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {m2o(r.stage_id)?.name ?? "?"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="secondary"
                      className={`text-[10px] font-bold uppercase ${PAY_BADGE[r.payment_state]}`}
                    >
                      {r.payment_state}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(0);
          }}
        />
      </div>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense
      fallback={<div className="p-12 text-center text-slate-400">Loading...</div>}
    >
      <OrdersInner />
    </Suspense>
  );
}
