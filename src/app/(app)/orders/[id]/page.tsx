"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Printer,
  Mail,
  FileText,
  User as UserIcon,
  Play,
  Pause,
} from "lucide-react";
import { AddressLink, PhoneLink } from "@/components/address-link";
import { fmtDate, fmtMoney, fmtNum, m2o } from "@/lib/utils";
import { doorTypeLabel, colorLabel, colorDot } from "@/lib/labels";
import { ActivityFeed } from "@/components/activity-feed";
import { FilesDocumentsPanel } from "@/components/files-documents-panel";
import { StockMatchBanner } from "@/components/stock-match-banner";
import { SendToDropdown } from "@/components/send-to-dropdown";
import { ProductionTimeline } from "@/components/production-timeline";
import { EditOrderPanel } from "@/components/edit-order-panel";
import { HoldModal } from "@/components/hold-modal";
import { StageWizardModal, STAGE_WIZARDS } from "@/components/stage-wizard-modal";
import { OrderDetailSkeleton } from "@/components/skeleton";
import { ErrorState } from "@/components/state-cards";
import { AssignmentCard } from "@/components/assignment-card";
import { NextActionCard } from "@/components/next-action-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deriveRole } from "@/lib/odoo/types";
import { cn } from "@/lib/utils";

interface OrderDetail {
  order: Record<string, unknown>;
  lines: Record<string, unknown>[];
  stages: Array<{ id: number; name: string; sequence: number; code: string }>;
  installers: Array<{ id: number; name: string }>;
  labelPdfUrl: string;
  paintSheetPdfUrl: string;
  orderCardPdfUrl: string;
  designImage: string | null;
}

interface MePayload {
  user: { isAdmin: boolean; groups: string[] } | null;
}

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery<OrderDetail>({
    queryKey: ["order", id],
    // Throw on non-2xx so react-query surfaces it via isError (otherwise a
    // 500/network failure would be swallowed and look like "not found").
    queryFn: async () => {
      const r = await fetch(`/api/orders/${id}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(j?.error || `Request failed (${r.status})`) as Error & {
          status?: number;
        };
        err.status = r.status;
        throw err;
      }
      return j;
    },
    retry: 1,
  });
  const { data: me } = useQuery<MePayload>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then((r) => r.json()),
  });
  const role = me?.user ? deriveRole(me.user.groups) : null;
  const canAssign = !!(role?.isManager || role?.isOffice || me?.user?.isAdmin);

  if (isLoading) return <OrderDetailSkeleton />;

  // Distinguish a genuine 404 (order doesn't exist / no access) from a
  // transient load failure (500 / network) — the latter gets a retry.
  if (isError) {
    const status = (error as (Error & { status?: number }) | null)?.status;
    const notFound = status === 404;
    return (
      <ErrorState
        title={notFound ? "Order not found" : "Couldn't load this order"}
        message={
          notFound
            ? `Order #${id} doesn't exist or you don't have permission to see it.`
            : "Something went wrong loading the order. Check your connection and try again."
        }
        backHref="/orders"
        onRetry={notFound ? undefined : () => refetch()}
      />
    );
  }

  if (!data?.order)
    return (
      <ErrorState
        title="Order not found"
        message={`Order #${id} doesn't exist or you don't have permission to see it.`}
        backHref="/orders"
      />
    );

  const o = data.order as {
    id: number;
    name: string;
    client_name: string;
    client_phone: string;
    client_email: string;
    client_address: string;
    dealer_id: [number, string] | false;
    dealer_ref: string;
    stage_id: [number, string] | false;
    stage_code: string;
    on_hold: boolean;
    door_count: number;
    total_sqf: number;
    total_dealer_charge: number;
    installation_fee?: number;
    install_zone_name?: string | false;
    client_zip?: string | false;
    payment_state: string;
    create_date: string;
    notes: string;
    priv_ref: string;
    customer_po: string;
    painter_id: [number, string] | false;
    installer_ids: number[] | Array<[number, string]>;
  };

  const lines = data.lines as Array<{
    id: number;
    design_id: [number, string] | false;
    door_type: string;
    color: string;
    glass_type: string;
    width: number;
    height: number;
    width_label: string;
    height_label: string;
    qty: number;
    parts_count?: number;
    sqf: number;
    is_privacy_glass: boolean;
  }>;

  const dealer = m2o(o.dealer_id);
  const currentStage = data.stages.find((s) => s.code === o.stage_code);
  const wizardCfg = STAGE_WIZARDS[o.stage_code];
  // suppress unused warning — dealer is shown via m2o in the cards below
  void dealer;

  // Human-readable stage name (coherent with the header badge) instead of
  // the raw code (e.g. "Ready for Installation" not "ready_install").
  const stageLabel = currentStage?.name ?? m2o(o.stage_id)?.name ?? o.stage_code;

  // Multi-piece orders historically showed only piece 1 in the summary
  // cards. Surface "Mixed" when a field varies across pieces so a 3-door
  // order with different colors isn't misrepresented by piece 1.
  const multiPiece = lines.length > 1;
  const uniform = <T,>(get: (l: (typeof lines)[number]) => T) => {
    if (!lines.length) return { value: undefined as T | undefined, mixed: false };
    const first = get(lines[0]);
    return { value: first, mixed: lines.some((l) => get(l) !== first) };
  };
  const uDoorType = uniform((l) => l.door_type);
  const uColor = uniform((l) => l.color);
  const uPieces = uniform((l) => l.parts_count ?? 1);
  const firstBrand = m2o(
    (lines[0] as { brand_id?: [number, string] | false } | undefined)?.brand_id,
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/orders" className="hover:text-indigo-700">
          Orders
        </Link>
        <span>&rsaquo;</span>
        <span className="font-medium text-slate-800">{o.name}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Link
              href="/orders"
              className="rounded-xl p-1.5 text-slate-500 hover:bg-slate-100"
            >
              <ArrowLeft size={18} />
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl lg:text-3xl">
              Order {o.name}
            </h1>
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                o.stage_code === "painting"
                  ? "bg-orange-50 text-orange-700"
                  : "bg-indigo-50 text-indigo-700"
              }`}
            >
              ● {m2o(o.stage_id)?.name}
            </span>
            {o.on_hold && (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold uppercase text-amber-700">
                On hold
              </span>
            )}
          </div>
          <p className="ml-9 mt-1 text-sm text-slate-500">
            Created {fmtDate(o.create_date)} ·{" "}
            {data.lines.length} piece{data.lines.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={data.orderCardPdfUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            <Printer size={14} />
            Print
          </a>
          {canAssign && (
            <EditOrderPanel
              order={{
                id: o.id,
                client_name: o.client_name,
                client_phone: o.client_phone,
                client_email: o.client_email,
                client_address: o.client_address,
                dealer_ref: o.dealer_ref,
                priv_ref: o.priv_ref,
                customer_po: o.customer_po,
              }}
              lines={lines.map((l) => ({
                id: l.id,
                design_id: l.design_id,
                door_type: l.door_type,
                color: l.color,
                glass_type: l.glass_type,
                glass_privacy: (l as { glass_privacy?: string }).glass_privacy ?? "",
                brand_id: (l as { brand_id?: [number, string] | false }).brand_id ?? false,
                width: l.width,
                height: l.height,
                width_label: l.width_label,
                height_label: l.height_label,
                qty: l.qty,
              }))}
              trigger="header"
              editing={editingOrder}
              onEditingChange={setEditingOrder}
            />
          )}
          {canAssign && (
            <SendToDropdown
              orderId={o.id}
              orderName={o.name}
              currentStageCode={o.stage_code}
              stages={data.stages}
            />
          )}
          {wizardCfg && (
            <Button
              size="lg"
              onClick={() => setWizardOpen(true)}
              className="bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700"
            >
              <Play size={14} />
              {wizardCfg.title}
            </Button>
          )}
          {canAssign && (
            <Button variant="outline" size="lg" onClick={() => setHoldOpen(true)}>
              {o.on_hold ? (
                <>
                  <Play size={14} /> Release from Hold
                </>
              ) : (
                <>
                  <Pause size={14} /> Move to Hold
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Next-action steer — tells the operator what to do next based
          on the current stage. Includes "Mark as Paid" when payment is
          the obvious next move. */}
      <NextActionCard
        orderId={o.id}
        stageCode={o.stage_code}
        onHold={o.on_hold}
        paymentState={o.payment_state}
        onOpenWizard={wizardCfg ? () => setWizardOpen(true) : undefined}
        wizardLabel={wizardCfg?.title}
      />

      {/* Edit panel — appears when "Edit order" is toggled in the header. */}
      {canAssign && (
        <EditOrderPanel
          order={{
            id: o.id,
            client_name: o.client_name,
            client_phone: o.client_phone,
            client_email: o.client_email,
            client_address: o.client_address,
            dealer_ref: o.dealer_ref,
            priv_ref: o.priv_ref,
            customer_po: o.customer_po,
          }}
          lines={lines.map((l) => ({
            id: l.id,
            design_id: l.design_id,
            door_type: l.door_type,
            color: l.color,
            glass_type: l.glass_type,
            glass_privacy: (l as { glass_privacy?: string }).glass_privacy ?? "",
            width: l.width,
            height: l.height,
            width_label: l.width_label,
            height_label: l.height_label,
            qty: l.qty,
          }))}
          trigger="inline"
          editing={editingOrder}
          onEditingChange={setEditingOrder}
        />
      )}

      {/* Stock-match banner — only shown when an order in pre-CNC stage
          has finished doors in the stock pool that match its design. */}
      <StockMatchBanner
        orderId={parseInt(id, 10)}
        disabled={
          ["cnc", "painting", "ready_install", "install_scheduled", "installed", "invoiced", "closed"].includes(o.stage_code)
        }
      />

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* LEFT col */}
        <div className="space-y-5 lg:col-span-9">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Door image — single render matching the order's color.
                The endpoint falls back to the design's cover image if
                no color-tagged attachment exists. */}
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="flex h-64 items-center justify-center overflow-hidden rounded-xl bg-slate-50">
                {lines[0]?.design_id ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`/api/catalog/designs/${(lines[0].design_id as [number, string])[0]}/image?${new URLSearchParams({ ...(lines[0]?.color ? { color: lines[0].color } : {}), ...(lines[0]?.door_type ? { type: lines[0].door_type } : {}) }).toString()}`}
                    alt={`${(lines[0].design_id as [number, string])[1]} — ${lines[0]?.color ?? ""}`}
                    className="h-full w-auto object-contain"
                    onError={(e) => {
                      const el = e.currentTarget;
                      el.style.display = "none";
                      const sibling = el.nextElementSibling as HTMLElement | null;
                      if (sibling) sibling.style.display = "block";
                    }}
                  />
                ) : null}
                <span
                  className="text-sm text-slate-300"
                  style={{ display: lines[0]?.design_id ? "none" : "block" }}
                >
                  No design image
                </span>
              </div>
              {lines[0]?.color && (
                <div className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-500">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-slate-300"
                    style={{ background: colorDot(lines[0].color) }}
                  />
                  <span className="capitalize">
                    {lines[0].color.replace("_", " ")}
                  </span>
                </div>
              )}
            </div>

            {/* Order info */}
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                Order Number
              </div>
              <div className="mb-1 flex items-baseline gap-3">
                <span className="text-2xl font-bold text-slate-900">
                  {lines[0]?.design_id
                    ? m2o(lines[0].design_id)?.name
                    : "—"}
                </span>
              </div>
              {multiPiece && (
                <p className="mb-3 text-[11px] text-amber-700">
                  {lines.length} pieces — fields below reflect piece 1; see the
                  Pieces table for all.
                </p>
              )}

              <dl className="space-y-3 border-t border-slate-100 pt-3">
                <Row
                  label="Door Type"
                  value={uDoorType.mixed ? "Mixed" : doorTypeLabel(uDoorType.value)}
                />
                <Row
                  label="Color"
                  value={
                    uColor.mixed ? (
                      "Mixed"
                    ) : (
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{
                            background: colorDot(lines[0]?.color),
                            border: "1px solid #cbd5e1",
                          }}
                        />
                        {colorLabel(lines[0]?.color)}
                      </span>
                    )
                  }
                />
                <Row
                  label="Width"
                  value={
                    lines[0]?.width_label
                      ? `${lines[0].width_label} in`
                      : `${lines[0]?.width ?? "—"} in`
                  }
                />
                <Row
                  label="Height"
                  value={
                    lines[0]?.height_label
                      ? `${lines[0].height_label} in`
                      : `${lines[0]?.height ?? "—"} in`
                  }
                />
                <Row
                  label="Pieces"
                  value={uPieces.mixed ? "Mixed" : String(lines[0]?.parts_count ?? 1)}
                />
                <Row label="Brand" value={firstBrand?.name ?? "—"} />
                {/* Glass type hidden — not managed by the office. */}
                <Row
                  label="Privacy"
                  value={lines[0]?.is_privacy_glass ? "Privacy" : "Clear"}
                />
              </dl>
            </div>
          </div>

          {/* Client info + Notes */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2 font-semibold text-slate-800">
                <UserIcon size={16} className="text-indigo-700" />
                Client Information
              </div>
              <dl className="space-y-3">
                <Row label="Reference" value={o.dealer_ref || "—"} />
                <Row label="Customer PO" value={o.customer_po || "—"} />
                <Row label="Name" value={o.client_name} />
                <Row
                  label="Address"
                  value={<AddressLink address={o.client_address} />}
                />
                <Row
                  label="Phone"
                  value={<PhoneLink phone={o.client_phone} />}
                />
                <Row
                  label="Email"
                  value={
                    o.client_email ? (
                      <span className="flex items-center gap-1.5">
                        <Mail size={12} className="text-slate-400" />
                        {o.client_email}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
              </dl>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
                <FileText size={16} className="text-indigo-700" />
                Note
              </div>
              <div className="min-h-[100px] rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                {o.notes || "No notes yet."}
              </div>
              {/* Use `value` (controlled) instead of `defaultValue` so this
                  display follows the order's computed total_sqf as it
                  updates (e.g. after the SQF wizard runs, after Edit Order
                  saves new line dimensions). With `defaultValue` the input
                  would freeze at whatever total_sqf was on first mount —
                  which is why this box was showing 0 while the Order
                  Summary on the right showed the correct figure. */}
              <div className="mt-4 flex items-center gap-2 text-sm">
                <span className="text-slate-500">SQF</span>
                <input
                  type="text"
                  value={fmtNum(o.total_sqf)}
                  className="w-20 rounded-lg border border-input bg-background px-2 py-1 text-right text-sm shadow-xs"
                  readOnly
                />
                <span className="text-slate-500">SQFT</span>
              </div>
            </div>
          </div>

          {/* Pieces */}
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-3 font-semibold text-slate-800">Pieces</div>
            <div className="-mx-2 overflow-x-auto scrollbar-thin sm:mx-0">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
                  <th className="py-2">Design</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Color</th>
                  <th className="py-2">Brand</th>
                  <th className="py-2">Privacy</th>
                  <th className="py-2 text-right">W (in)</th>
                  <th className="py-2 text-right">H (in)</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Pieces</th>
                  <th className="py-2 text-right">SQF</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  // The Odoo line read returns brand_id + glass_privacy
                  // when they exist (v0.37+). We pick them off generically
                  // so old DBs without the column still render.
                  const brand = m2o(
                    (l as unknown as { brand_id?: [number, string] | false })
                      .brand_id,
                  );
                  const glassPrivacy =
                    (l as unknown as { glass_privacy?: string })
                      .glass_privacy ?? (l.is_privacy_glass ? "privacy" : "clear");

                  return (
                    <tr
                      key={l.id}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="py-2 font-medium text-indigo-700">
                        {m2o(l.design_id)?.name ?? "—"}
                      </td>
                      <td className="py-2">{doorTypeLabel(l.door_type)}</td>
                      <td className="py-2">{colorLabel(l.color)}</td>
                      <td className="py-2 font-medium uppercase text-slate-700">
                        {brand?.name ?? "—"}
                      </td>
                      <td className="py-2">
                        <Badge
                          variant="secondary"
                          className={
                            glassPrivacy === "privacy"
                              ? "bg-indigo-50 text-indigo-700"
                              : "bg-slate-100 text-slate-600"
                          }
                        >
                          {glassPrivacy === "privacy" ? "Privacy" : "Clear"}
                        </Badge>
                      </td>
                      <td className="py-2 text-right">{l.width_label || l.width}</td>
                      <td className="py-2 text-right">{l.height_label || l.height}</td>
                      <td className="py-2 text-right">{l.qty}</td>
                      <td className="py-2 text-right">{l.parts_count ?? 1}</td>
                      <td className="py-2 text-right font-semibold">
                        {fmtNum(l.sqf)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} className="py-3 text-right font-semibold text-slate-500">
                    Totals
                  </td>
                  <td className="py-3 text-right font-bold">{o.door_count}</td>
                  <td className="py-3 text-right font-bold">
                    {fmtNum(o.total_sqf)}
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>

          {/* Files & Documents — anchor target for the QuickPhotoUpload
              "View all" link on stage screens (orders/<id>#files). */}
          <div id="files">
            <FilesDocumentsPanel
              orderId={parseInt(id, 10)}
              reports={[
                { label: "Order Card", icon: "card", url: data.orderCardPdfUrl },
                { label: "Designer Label", icon: "ticket", url: data.labelPdfUrl },
                { label: "Painter Sheet", icon: "paint", url: data.paintSheetPdfUrl },
              ]}
            />
          </div>

          {/* Activity feed (mail.message chatter) */}
          <ActivityFeed orderId={parseInt(id, 10)} />
        </div>

        {/* RIGHT col — Production timeline + Summary */}
        <div className="space-y-5 lg:col-span-3">
          <ProductionTimeline orderId={parseInt(id, 10)} />

          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <FileText size={14} className="text-indigo-700" />
              Order Summary
            </div>
            <dl className="space-y-3 text-sm">
              <Row
                label="Door Type"
                value={uDoorType.mixed ? "Mixed" : uDoorType.value ?? "—"}
              />
              <Row
                label="Color"
                value={
                  uColor.mixed ? (
                    "Mixed"
                  ) : (
                    <span className="capitalize">
                      {lines[0]?.color?.replace("_", " ") ?? "—"}
                    </span>
                  )
                }
              />
              {/* Glass type hidden — not managed by the office. */}
              <Row label="SQF" value={fmtNum(o.total_sqf)} />
              {o.installation_fee && o.installation_fee > 0 ? (
                <Row
                  label="Install fee"
                  value={
                    <span>
                      {fmtMoney(o.installation_fee)}
                      {o.install_zone_name ? (
                        <span className="ml-1 text-[10px] text-slate-400">
                          ({String(o.install_zone_name).split("—")[0].trim()})
                        </span>
                      ) : null}
                    </span>
                  }
                />
              ) : null}
              <Row
                label="Status"
                value={
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      o.stage_code === "painting"
                        ? "bg-orange-50 text-orange-700"
                        : "bg-indigo-50 text-indigo-700",
                    )}
                  >
                    {stageLabel}
                  </span>
                }
              />
              <Row
                label="Total"
                value={
                  <span className="text-base font-bold text-emerald-700">
                    {fmtMoney(o.total_dealer_charge)}
                  </span>
                }
              />
            </dl>
          </div>

          <AssignmentCard
            orderId={o.id}
            painter={
              o.painter_id
                ? { id: o.painter_id[0], name: o.painter_id[1] }
                : null
            }
            installers={data.installers ?? []}
            canEdit={canAssign}
          />
        </div>
      </div>

      {wizardCfg && (
        <StageWizardModal
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["order", id] });
            qc.invalidateQueries({ queryKey: ["order-activity", parseInt(id, 10)] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
          }}
          orderId={parseInt(id, 10)}
          orderName={o.name}
          config={wizardCfg}
        />
      )}

      <HoldModal
        open={holdOpen}
        onClose={() => setHoldOpen(false)}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["order", id] });
          qc.invalidateQueries({ queryKey: ["order-activity", parseInt(id, 10)] });
          qc.invalidateQueries({ queryKey: ["dashboard"] });
        }}
        orderId={parseInt(id, 10)}
        orderName={o.name}
        releasing={o.on_hold}
      />
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  );
}
