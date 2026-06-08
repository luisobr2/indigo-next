"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Printer,
  Phone,
  MapPin,
  Mail,
  FileText,
  User as UserIcon,
  Play,
} from "lucide-react";
import { fmtMoney, fmtNum, m2o } from "@/lib/utils";
import { ActivityFeed } from "@/components/activity-feed";
import { StageWizardModal, STAGE_WIZARDS } from "@/components/stage-wizard-modal";
import { OrderDetailSkeleton } from "@/components/skeleton";
import { ErrorState } from "@/components/state-cards";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface OrderDetail {
  order: Record<string, unknown>;
  lines: Record<string, unknown>[];
  stages: Array<{ id: number; name: string; sequence: number; code: string }>;
  labelPdfUrl: string;
  paintSheetPdfUrl: string;
  orderCardPdfUrl: string;
  designImage: string | null;
}

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [wizardOpen, setWizardOpen] = useState(false);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<OrderDetail>({
    queryKey: ["order", id],
    queryFn: () => fetch(`/api/orders/${id}`).then((r) => r.json()),
  });

  if (isLoading) return <OrderDetailSkeleton />;

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
    payment_state: string;
    create_date: string;
    notes: string;
    priv_ref: string;
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
    sqf: number;
    is_privacy_glass: boolean;
  }>;

  const dealer = m2o(o.dealer_id);
  const currentStage = data.stages.find((s) => s.code === o.stage_code);
  const currentSeq = currentStage?.sequence ?? 0;
  const wizardCfg = STAGE_WIZARDS[o.stage_code];
  // suppress unused warning — dealer is shown via m2o in the cards below
  void dealer;

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
            Created {new Date(o.create_date).toLocaleDateString()} ·{" "}
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
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* LEFT col */}
        <div className="space-y-5 lg:col-span-9">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Door image */}
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="flex h-64 items-center justify-center overflow-hidden rounded-xl bg-slate-50">
                {data.designImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={data.designImage}
                    alt="Door design"
                    className="h-full w-auto object-contain"
                  />
                ) : (
                  <span className="text-sm text-slate-300">No design image</span>
                )}
              </div>
            </div>

            {/* Order info */}
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                Order Number
              </div>
              <div className="mb-4 flex items-baseline gap-3">
                <span className="text-2xl font-bold text-slate-900">
                  {lines[0]?.design_id
                    ? m2o(lines[0].design_id)?.name
                    : "—"}
                </span>
              </div>

              <dl className="space-y-3 border-t border-slate-100 pt-3">
                <Row label="Door Type" value={lines[0]?.door_type ?? "—"} />
                <Row
                  label="Color"
                  value={
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{
                          background:
                            lines[0]?.color === "white"
                              ? "#fff"
                              : lines[0]?.color === "bronze"
                                ? "#a16207"
                                : "#1f2937",
                          border: "1px solid #cbd5e1",
                        }}
                      />
                      {lines[0]?.color ?? "—"}
                    </span>
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
                <Row label="Brand" value="Indigo Decors" />
                <Row label="Glass" value={lines[0]?.glass_type ?? "—"} />
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
                <Row label="Name" value={o.client_name} />
                <Row
                  label="Address"
                  value={
                    <span className="flex items-start gap-1.5">
                      <MapPin size={12} className="mt-1 text-slate-400" />
                      <span className="whitespace-pre-line">
                        {o.client_address}
                      </span>
                    </span>
                  }
                />
                <Row
                  label="Phone"
                  value={
                    o.client_phone ? (
                      <span className="flex items-center gap-1.5">
                        <Phone size={12} className="text-slate-400" />
                        {o.client_phone}
                      </span>
                    ) : (
                      "—"
                    )
                  }
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
              <div className="mt-4 flex items-center gap-2 text-sm">
                <span className="text-slate-500">SQF</span>
                <input
                  type="text"
                  defaultValue={fmtNum(o.total_sqf)}
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
                  <th className="py-2">Glass</th>
                  <th className="py-2">Privacy</th>
                  <th className="py-2 text-right">W (in)</th>
                  <th className="py-2 text-right">H (in)</th>
                  <th className="py-2 text-right">Qty</th>
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
                      <td className="py-2">{l.door_type}</td>
                      <td className="py-2 capitalize">{l.color}</td>
                      <td className="py-2 font-medium uppercase text-slate-700">
                        {brand?.name ?? "—"}
                      </td>
                      <td className="py-2">{l.glass_type}</td>
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

          {/* Activity feed (mail.message chatter) */}
          <ActivityFeed orderId={parseInt(id, 10)} />
        </div>

        {/* RIGHT col — Progress + Summary */}
        <div className="space-y-5 lg:col-span-3">
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-4 text-xs font-bold uppercase tracking-wide text-slate-500">
              Order Progress
            </div>
            <ol className="relative space-y-4">
              {data.stages
                .filter((s) => !["closed"].includes(s.code))
                .map((s) => {
                  const done = s.sequence < currentSeq;
                  const current = s.sequence === currentSeq;
                  return (
                    <li key={s.id} className="flex items-start gap-3">
                      {done ? (
                        <CheckCircle2
                          size={18}
                          className="mt-0.5 shrink-0 text-emerald-500"
                        />
                      ) : current ? (
                        <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-700 ring-4 ring-indigo-100">
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                      ) : (
                        <Circle
                          size={18}
                          className="mt-0.5 shrink-0 text-slate-300"
                        />
                      )}
                      <div className="flex-1">
                        <div
                          className={`text-sm font-semibold ${
                            current
                              ? "text-indigo-700"
                              : done
                                ? "text-slate-800"
                                : "text-slate-400"
                          }`}
                        >
                          {s.name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {done ? "Completed" : current ? "In Progress" : "Pending"}
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ol>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <FileText size={14} className="text-indigo-700" />
              Order Summary
            </div>
            <dl className="space-y-3 text-sm">
              <Row label="Door Type" value={lines[0]?.door_type ?? "—"} />
              <Row label="Color" value={lines[0]?.color ?? "—"} />
              <Row label="Glass" value={lines[0]?.glass_type ?? "—"} />
              <Row label="SQF" value={fmtNum(o.total_sqf)} />
              <Row
                label="Status"
                value={
                  <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase text-orange-700">
                    {o.stage_code === "painting" ? "In Progress" : o.stage_code}
                  </span>
                }
              />
              <Row
                label="Created By"
                value={
                  <span className="text-indigo-700 font-medium">Majela</span>
                }
              />
              <Row
                label="Assigned To"
                value={
                  <span className="text-indigo-700 font-medium">
                    {o.stage_code === "painting" ? "Painting Team" : "—"}
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
