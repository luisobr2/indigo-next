"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Search,
  Download,
  Printer,
  Table2,
  Columns3,
  Archive,
  Trash2,
  AlertCircle,
  X,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { fmtDate, fmtMoney, fmtNum, m2o } from "@/lib/utils";
import { paymentLabel } from "@/lib/labels";
import { TableSkeleton } from "@/components/skeleton";
import { EmptyState } from "@/components/state-cards";
import { toCsv, downloadCsv } from "@/lib/csv";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Pagination } from "@/components/pagination";
import { BulkSendToButton } from "@/components/bulk-send-to-button";
import { NewOrderButton } from "@/components/new-order-button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { deriveRole } from "@/lib/odoo/types";

interface Dealer {
  id: number;
  name: string;
}

interface MeResponse {
  user: { isAdmin?: boolean } | null;
  role: ReturnType<typeof deriveRole> | null;
}

const STAGE_OPTIONS = [
  { code: "new", label: "New Order" },
  { code: "design_pending", label: "Design Confirmation Pending" },
  { code: "design_confirmed", label: "Design Confirmed" },
  { code: "measure_pending", label: "Measurement Pending" },
  { code: "measured", label: "Measured" },
  { code: "ready_digitalization", label: "Ready for Digitalization" },
  { code: "cnc", label: "CNC / Router" },
  { code: "painting", label: "Painting" },
  { code: "ready_install", label: "Ready for Installation" },
  { code: "install_scheduled", label: "Installation Scheduled" },
  { code: "installed", label: "Installed" },
  { code: "invoiced", label: "Invoiced / Paid" },
  { code: "closed", label: "Closed" },
] as const;

interface OrderRow {
  id: number;
  name: string;
  dealer_id: [number, string] | false;
  dealer_ref: string | false;
  customer_po: string | false;
  client_name: string;
  client_phone: string | false;
  client_email: string | false;
  client_address: string;
  notes: string | false;
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

// ----- Configurable columns for the Orders table -----
// Each column knows how to render its cell and how to print itself (text).
// `order` is always shown (it's the row link). Visibility is saved per user
// in localStorage; the Print list follows whatever is visible.
interface OrderCol {
  key: string;
  label: string;
  thClass?: string;
  cell: (r: OrderRow) => ReactNode;
  print: (r: OrderRow) => string;
}

const ORDER_COLUMNS: OrderCol[] = [
  {
    key: "order",
    label: "Order #",
    cell: (r) => (
      <>
        <Link
          href={`/orders/${r.id}`}
          className="flex items-center gap-1.5 font-medium text-indigo-700 hover:underline"
        >
          {r.name}
          {r.is_overdue && <AlertCircle size={12} className="text-rose-500" />}
        </Link>
        <div className="text-xs text-slate-400">{fmtDate(r.create_date)}</div>
      </>
    ),
    print: (r) => r.name,
  },
  {
    key: "code",
    label: "Code",
    cell: (r) => <span className="text-slate-600">{(r.dealer_ref as string) || "—"}</span>,
    print: (r) => (r.dealer_ref as string) || "",
  },
  {
    key: "po",
    label: "PO",
    cell: (r) => <span className="text-slate-600">{(r.customer_po as string) || "—"}</span>,
    print: (r) => (r.customer_po as string) || "",
  },
  {
    key: "client",
    label: "Client",
    cell: (r) => <span className="font-medium text-slate-800">{r.client_name}</span>,
    print: (r) => r.client_name,
  },
  {
    key: "phone",
    label: "Phone",
    cell: (r) => <span className="whitespace-nowrap text-slate-600">{(r.client_phone as string) || "—"}</span>,
    print: (r) => (r.client_phone as string) || "",
  },
  {
    key: "email",
    label: "Email",
    cell: (r) => <span className="text-slate-600">{(r.client_email as string) || "—"}</span>,
    print: (r) => (r.client_email as string) || "",
  },
  {
    key: "dealer",
    label: "Dealer",
    cell: (r) => <span className="text-slate-600">{m2o(r.dealer_id)?.name ?? "—"}</span>,
    print: (r) => m2o(r.dealer_id)?.name ?? "",
  },
  {
    key: "stage",
    label: "Stage",
    cell: (r) => (
      <>
        <Badge
          variant="secondary"
          className={`text-[10px] font-bold uppercase tracking-wide ${STAGE_BADGE[r.stage_code] ?? "bg-slate-100 text-slate-700"}`}
        >
          {m2o(r.stage_id)?.name ?? "?"}
        </Badge>
        {r.on_hold && (
          <Badge variant="secondary" className="ml-1 bg-amber-100 text-[10px] font-bold uppercase text-amber-800">
            On hold
          </Badge>
        )}
      </>
    ),
    print: (r) => m2o(r.stage_id)?.name ?? "",
  },
  {
    key: "days",
    label: "Days",
    thClass: "text-right",
    cell: (r) => (
      <span
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
          r.days_in_current_stage >= 7
            ? "bg-rose-50 text-rose-700"
            : r.days_in_current_stage >= 4
              ? "bg-amber-50 text-amber-700"
              : "text-slate-500"
        }`}
      >
        {r.days_in_current_stage}d
      </span>
    ),
    print: (r) => `${r.days_in_current_stage}d`,
  },
  {
    key: "address",
    label: "Address",
    cell: (r) => <div className="line-clamp-2 max-w-[260px] text-slate-500">{r.client_address}</div>,
    print: (r) => (r.client_address || "").replace(/\n/g, " "),
  },
  {
    key: "note",
    label: "Note",
    cell: (r) => <div className="line-clamp-2 max-w-[240px] text-slate-500">{(r.notes as string) || ""}</div>,
    print: (r) => ((r.notes as string) || "").replace(/\n/g, " "),
  },
  {
    key: "doors",
    label: "Doors",
    thClass: "text-right",
    cell: (r) => <span className="tabular-nums">{r.door_count}</span>,
    print: (r) => String(r.door_count),
  },
  {
    key: "sqf",
    label: "SQF",
    thClass: "text-right",
    cell: (r) => <span className="tabular-nums">{fmtNum(r.total_sqf)}</span>,
    print: (r) => String(r.total_sqf),
  },
  {
    key: "total",
    label: "Total",
    thClass: "text-right",
    cell: (r) => <span className="font-semibold tabular-nums text-slate-800">{fmtMoney(r.total_dealer_charge)}</span>,
    print: (r) => fmtMoney(r.total_dealer_charge),
  },
  {
    key: "payment",
    label: "Payment",
    cell: (r) => (
      <Badge variant="secondary" className={`text-[10px] font-bold uppercase ${PAY_BADGE[r.payment_state]}`}>
        {paymentLabel(r.payment_state)}
      </Badge>
    ),
    print: (r) => paymentLabel(r.payment_state),
  },
];

const ORDER_COL_MAP = Object.fromEntries(ORDER_COLUMNS.map((c) => [c.key, c]));
const DEFAULT_ORDER_COLS = ["order", "client", "dealer", "stage", "days", "address", "doors", "sqf", "total", "payment"];
const ORDER_COL_PRESETS: Record<string, string[]> = {
  "Call list": ["order", "code", "client", "phone", "note"],
  Production: ["order", "client", "dealer", "stage", "days", "doors"],
  Billing: ["order", "client", "dealer", "total", "payment"],
};
const ORDER_COLS_KEY = "indigo:order-cols";

function OrdersInner() {
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Column visibility — persisted per user in localStorage. "order" is always
  // shown. The visible columns drive both the table and the Print list.
  const [colKeys, setColKeys] = useState<string[]>(DEFAULT_ORDER_COLS);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ORDER_COLS_KEY);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length) {
          setColKeys(["order", ...arr.filter((k: string) => k !== "order" && ORDER_COL_MAP[k])]);
        }
      }
    } catch {
      /* ignore corrupt prefs */
    }
  }, []);
  function persistCols(keys: string[]) {
    const next = ["order", ...keys.filter((k) => k !== "order" && ORDER_COL_MAP[k])];
    setColKeys(next);
    try {
      localStorage.setItem(ORDER_COLS_KEY, JSON.stringify(next));
    } catch {
      /* storage may be blocked; in-memory still works */
    }
  }
  function toggleCol(key: string) {
    if (key === "order") return;
    persistCols(
      colKeys.includes(key) ? colKeys.filter((k) => k !== key) : [...colKeys, key],
    );
  }
  // Columns to actually render, in catalog order (keeps a sensible layout
  // regardless of toggle order).
  const visibleCols = ORDER_COLUMNS.filter((c) => colKeys.includes(c.key));

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  // Filter state — controlled by URL so the picker survives navigation
  // and back/forward. Empty string = "no filter".
  const [stage, setStage] = useState<string>(sp.get("stage") ?? "");
  const [dealer, setDealer] = useState<string>(sp.get("dealer") ?? "");
  const [payment, setPayment] = useState<string>(sp.get("payment") ?? "");
  const [flag, setFlag] = useState<string>(
    sp.get("overdue") === "true"
      ? "overdue"
      : sp.get("on_hold") === "true"
        ? "on_hold"
        : "",
  );

  // Who am I? Gates the "New Order" button to roles allowed to create
  // orders (manager / office / admin) — the POST endpoint enforces the same.
  const meQ = useQuery<MeResponse>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });
  const canCreate =
    !!meQ.data?.role &&
    (meQ.data.role.isManager ||
      meQ.data.role.isOffice ||
      !!meQ.data.user?.isAdmin);
  // Archive: manager/office/admin (write). Delete: manager/admin only (unlink).
  const canArchive = canCreate;
  const canDelete = !!(meQ.data?.role?.isManager || meQ.data?.user?.isAdmin);

  async function bulkAction(action: "archive" | "unarchive" | "delete") {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const n = ids.length;
    const msg =
      action === "archive"
        ? `Archive ${n} order${n === 1 ? "" : "s"}? They'll be hidden from the list but kept, and can be restored later.`
        : action === "unarchive"
          ? `Restore ${n} order${n === 1 ? "" : "s"} to the active list?`
          : `Delete ${n} order${n === 1 ? "" : "s"} permanently? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    const p = fetch("/api/orders/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Failed");
      clearSelection();
      qc.invalidateQueries({ queryKey: ["orders"] });
      return j;
    });
    const verb =
      action === "archive" ? "Archived" : action === "unarchive" ? "Restored" : "Deleted";
    toast.promise(p, {
      loading:
        action === "archive" ? "Archiving…" : action === "unarchive" ? "Restoring…" : "Deleting…",
      success: `${verb} ${n} order${n === 1 ? "" : "s"}`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  // Pull dealers for the dropdown.
  const dealersQ = useQuery<{ records: Dealer[] }>({
    queryKey: ["catalog-dealers"],
    queryFn: () => fetch("/api/catalog/dealers").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });

  // Stage list for the bulk "Move Selected To" picker. Cached widely.
  const stagesQ = useQuery<{
    records: Array<{ id: number; name: string; code: string; sequence: number }>;
  }>({
    queryKey: ["stages-list"],
    queryFn: () => fetch("/api/stages").then((r) => r.json()),
    staleTime: 10 * 60_000,
  });

  const qc = useQueryClient();

  // Debounce the search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Any filter change → reset to first page + reflect in URL.
  useEffect(() => {
    setPage(0);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (stage) params.set("stage", stage);
    if (dealer) params.set("dealer", dealer);
    if (payment) params.set("payment", payment);
    if (flag === "overdue") params.set("overdue", "true");
    if (flag === "on_hold") params.set("on_hold", "true");
    const qs = params.toString();
    const next = qs ? `?${qs}` : "";
    window.history.replaceState(null, "", `/orders${next}`);
  }, [stage, dealer, payment, flag]);

  const activeFilterCount =
    (stage ? 1 : 0) +
    (dealer ? 1 : 0) +
    (payment ? 1 : 0) +
    (flag ? 1 : 0);

  function clearFilters() {
    setStage("");
    setDealer("");
    setPayment("");
    setFlag("");
  }

  const { data, isLoading } = useQuery<{
    records: OrderRow[];
    total: number;
  }>({
    queryKey: [
      "orders",
      stage,
      dealer,
      payment,
      flag,
      debouncedQ,
      page,
      pageSize,
    ],
    queryFn: async () => {
      const url = new URL("/api/orders", window.location.origin);
      if (stage) url.searchParams.set("stage", stage);
      if (dealer) url.searchParams.set("dealer", dealer);
      if (payment) url.searchParams.set("payment", payment);
      if (flag === "overdue") url.searchParams.set("overdue", "true");
      if (flag === "on_hold") url.searchParams.set("on_hold", "true");
      if (flag === "archived") url.searchParams.set("archived", "1");
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

  // Print the whole FILTERED list as one document (not one sheet per order).
  // Re-fetches every matching order (ignores pagination) so the printout
  // covers the full filtered view, then opens a print-ready window.
  async function printList() {
    const url = new URL("/api/orders", window.location.origin);
    if (stage) url.searchParams.set("stage", stage);
    if (dealer) url.searchParams.set("dealer", dealer);
    if (payment) url.searchParams.set("payment", payment);
    if (flag === "overdue") url.searchParams.set("overdue", "true");
    if (flag === "on_hold") url.searchParams.set("on_hold", "true");
    if (flag === "archived") url.searchParams.set("archived", "1");
    if (debouncedQ) url.searchParams.set("q", debouncedQ);
    url.searchParams.set("limit", "2000");
    url.searchParams.set("offset", "0");

    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Allow pop-ups to print the list");
      return;
    }
    w.document.write("<p style='font:14px sans-serif;padding:24px'>Preparing list…</p>");

    try {
      const res = (await fetch(url).then((r) => r.json())) as { records: OrderRow[] };
      const rows = res.records ?? [];
      if (!rows.length) {
        w.close();
        toast.warning("No orders to print");
        return;
      }
      const parts: string[] = [];
      if (stage) parts.push(STAGE_OPTIONS.find((s) => s.code === stage)?.label ?? stage);
      if (dealer) parts.push(dealersQ.data?.records.find((d) => String(d.id) === dealer)?.name ?? "Dealer");
      if (payment) parts.push(paymentLabel(payment));
      if (flag === "overdue") parts.push("Overdue");
      if (flag === "on_hold") parts.push("On hold");
      if (debouncedQ) parts.push(`“${debouncedQ}”`);
      const subtitle = parts.length ? parts.join(" · ") : "All orders";

      const esc = (v: unknown) =>
        String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
      // Print follows the columns the user has chosen on screen, + a blank
      // tick column at the end for marking off as you work the list.
      const cols = ORDER_COLUMNS.filter((c) => colKeys.includes(c.key));
      const body = rows
        .map(
          (r) =>
            `<tr>${cols.map((c) => `<td>${esc(c.print(r))}</td>`).join("")}<td class="chk"></td></tr>`,
        )
        .join("");
      const head = `${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}<th>✔</th>`;

      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8">
        <title>Orders — ${esc(subtitle)}</title>
        <style>
          body{margin:22px;color:#111;font-family:Arial,Helvetica,sans-serif;}
          h1{font-size:17px;margin:0 0 2px;color:#1f4486;}
          .sub{font-size:11px;color:#555;margin-bottom:12px;}
          table{width:100%;border-collapse:collapse;font-size:10px;}
          th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top;}
          th{background:#1f4486;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
          td.r,th.r{text-align:right;white-space:nowrap;}
          td.nw{white-space:nowrap;}
          td.chk{width:34px;}
          thead{display:table-header-group;}
          tr{page-break-inside:avoid;}
          @page{size:landscape;margin:12mm;}
        </style></head><body>
        <h1>Indigo Decors — Orders</h1>
        <div class="sub">${esc(subtitle)} · ${rows.length} order${rows.length === 1 ? "" : "s"} · ${esc(new Date().toLocaleString())}</div>
        <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        <script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>
        </body></html>`);
      w.document.close();
    } catch {
      w.close();
      toast.error("Couldn't prepare the list");
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Orders
            {stage && (
              <span className="text-slate-500">
                {" "}— {STAGE_OPTIONS.find((s) => s.code === stage)?.label ?? stage}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {fmtNum(total)} order{total === 1 ? "" : "s"} found
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && <NewOrderButton />}
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
              <BulkSendToButton
                orderIds={Array.from(selected)}
                stages={stagesQ.data?.records ?? []}
                onSuccess={() => {
                  clearSelection();
                  qc.invalidateQueries({ queryKey: ["orders"] });
                }}
              />
              {canArchive && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => bulkAction(flag === "archived" ? "unarchive" : "archive")}
                >
                  <Archive size={14} />
                  {flag === "archived" ? "Restore" : "Archive"}
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => bulkAction("delete")}
                  className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                >
                  <Trash2 size={14} />
                  Delete
                </Button>
              )}
            </>
          )}
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              // When a selection exists, export EVERY ticked row even if
              // some of them aren't on the visible page. Otherwise export
              // the visible records as a fallback.
              const targets = selected.size > 0
                ? records.filter((r) => selected.has(r.id))
                : records;
              if (selected.size > 0 && targets.length < selected.size) {
                toast.warning(
                  `Only ${targets.length} of ${selected.size} selected rows are on this page — export will skip the off-page ones. Go to those pages first if you want them included.`,
                  { duration: 6000 },
                );
              }
              if (!targets.length) {
                toast.warning("No orders to export");
                return;
              }
              const csv = toCsv(targets, [
                { header: "Order #", value: (r) => r.name },
                { header: "Client", value: (r) => r.client_name },
                { header: "Dealer", value: (r) => m2o(r.dealer_id)?.name ?? "" },
                { header: "Reference", value: (r) => r.client_address?.replace(/\n/g, " ") ?? "" },
                { header: "Doors", value: (r) => r.door_count },
                { header: "SQF", value: (r) => r.total_sqf },
                { header: "Total (USD)", value: (r) => r.total_dealer_charge },
                { header: "Stage", value: (r) => m2o(r.stage_id)?.name ?? "" },
                { header: "Payment", value: (r) => paymentLabel(r.payment_state) },
                { header: "Created", value: (r) => fmtDate(r.create_date) },
              ]);
              downloadCsv(`indigo-orders-${new Date().toISOString().slice(0, 10)}.csv`, csv);
              toast.success(`Exported ${targets.length} orders`);
            }}
          >
            <Download size={14} />
            Export
            {selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
          <Button variant="outline" size="lg" onClick={printList}>
            <Table2 size={14} />
            Print list
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
              <Columns3 size={14} />
              Columns
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Presets
                </DropdownMenuLabel>
                {Object.entries(ORDER_COL_PRESETS).map(([name, keys]) => (
                  <DropdownMenuItem key={name} onClick={() => persistCols(keys)}>
                    {name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Columns
                </DropdownMenuLabel>
                {ORDER_COLUMNS.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.key}
                    checked={colKeys.includes(c.key)}
                    disabled={c.key === "order"}
                    closeOnClick={false}
                    onCheckedChange={() => toggleCol(c.key)}
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              // Print rule:
              //   - Selected rows → print EVERY ticked id (across pages),
              //     since Odoo only needs ids, not visible records.
              //   - No selection + page small (≤20) → print the page.
              //   - No selection + page large → ask the user to pick rows
              //     so we don't blast 80 PDFs unintentionally.
              const ids = selected.size > 0
                ? Array.from(selected)
                : records.length <= 20
                  ? records.map((r) => r.id)
                  : null;
              if (!ids) {
                toast.warning(
                  `Showing ${records.length} orders — select rows first, or narrow filters so the page has ≤ 20.`,
                  { duration: 6000 },
                );
                return;
              }
              if (!ids.length) {
                toast.warning("No orders to print");
                return;
              }
              openOdooReport({
                report: REPORTS.orderCard,
                ids,
                filename: `orders-${new Date().toISOString().slice(0, 10)}.pdf`,
              });
              toast.success(`Generating PDF for ${ids.length} order${ids.length === 1 ? "" : "s"}…`);
            }}
          >
            <Printer size={14} />
            Print sheets
            {selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
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

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-100">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Filters
          </span>

          <FilterSelect
            placeholder="Stage"
            value={stage}
            options={STAGE_OPTIONS.map((s) => ({ value: s.code, label: s.label }))}
            onChange={setStage}
            width="220px"
          />

          <FilterSelect
            placeholder="Dealer"
            value={dealer}
            options={(dealersQ.data?.records ?? []).map((d) => ({
              value: String(d.id),
              label: d.name,
            }))}
            onChange={setDealer}
            width="200px"
          />

          <FilterSelect
            placeholder="Payment"
            value={payment}
            options={[
              { value: "unpaid", label: "Unpaid" },
              { value: "partial", label: "Partial" },
              { value: "paid", label: "Paid" },
            ]}
            onChange={setPayment}
            width="170px"
          />

          <FilterSelect
            placeholder="Flag"
            value={flag}
            options={[
              { value: "overdue", label: "Overdue" },
              { value: "on_hold", label: "On hold" },
              { value: "archived", label: "Archived" },
            ]}
            onChange={setFlag}
            width="160px"
          />

          {activeFilterCount > 0 && (
            <>
              <Badge
                variant="secondary"
                className="bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700"
              >
                {activeFilterCount} active
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-slate-500 hover:text-slate-800"
              >
                <X size={14} />
                Clear
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 w-10">
                <Checkbox
                  checked={
                    records.length > 0 &&
                    records.every((r) => selected.has(r.id))
                  }
                  onCheckedChange={(v) => {
                    if (v) {
                      setSelected(
                        (prev) =>
                          new Set([...prev, ...records.map((r) => r.id)]),
                      );
                    } else {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const r of records) next.delete(r.id);
                        return next;
                      });
                    }
                  }}
                  aria-label="Select all on this page"
                />
              </th>
              {visibleCols.map((c) => (
                <th key={c.key} className={`px-4 py-3 ${c.thClass ?? ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={visibleCols.length + 1} className="p-0">
                  <TableSkeleton rows={6} cols={10} />
                </td>
              </tr>
            )}
            {!isLoading && records.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length + 1} className="p-0">
                  <EmptyState
                    title="No orders match"
                    message="Try clearing filters or searching by client name."
                  />
                </td>
              </tr>
            )}
            {records.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-slate-100 transition hover:bg-slate-50 ${
                    selected.has(r.id) ? "bg-indigo-50/40" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={() => toggleOne(r.id)}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                  {visibleCols.map((c) => (
                    <td key={c.key} className={`px-4 py-3 ${c.thClass ?? ""}`}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
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

/**
 * Native <select> wrapped in a styled shell. We deliberately avoid the
 * Base UI Select here because its Value primitive renders the raw value
 * string instead of the matched item's label when the underlying option
 * set is dynamic (e.g. dealers fetched async). For a tiny dropdown the
 * native control is faster, accessible by default, and integrates with
 * the OS picker on mobile.
 */
function FilterSelect({
  placeholder,
  value,
  options,
  onChange,
  width,
}: {
  placeholder: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  width: string;
}) {
  const active = value !== "";
  return (
    <div className="relative" style={{ width }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-11 w-full appearance-none rounded-xl border bg-white pl-3.5 pr-9 text-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 ${
          active
            ? "border-indigo-200 font-semibold text-indigo-700"
            : "border-slate-200 text-slate-700"
        }`}
      >
        <option value="">{placeholder}: any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        fill="none"
      >
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
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
