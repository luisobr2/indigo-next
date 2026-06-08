"use client";
import {
  Paintbrush,
  Settings as Gear,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { StageScreenV2 } from "@/components/stage-screen-v2";
import { fmtMoney, fmtNum } from "@/lib/utils";

const PAINT_RATE = 8;

export default function PaintPage() {
  return (
    <StageScreenV2
      title="Paint"
      subtitle={`Painting worksheet. SQF × $${PAINT_RATE.toFixed(2)} per SQF.`}
      stageCode="painting"
      subStatusPrefix="paint"
      startActionLabel="Start Painting"
      includeLines
      tabs={[
        {
          key: "ready",
          label: "Ready to Paint",
          icon: Paintbrush,
          iconBg: "bg-sky-50",
          iconColor: "text-sky-700",
          pillBg: "bg-sky-50",
          pillText: "text-sky-700",
        },
        {
          key: "in_progress",
          label: "In Progress",
          icon: Gear,
          iconBg: "bg-amber-50",
          iconColor: "text-amber-600",
          pillBg: "bg-amber-50",
          pillText: "text-amber-700",
        },
        {
          key: "completed",
          label: "Completed",
          icon: CheckCircle2,
          iconBg: "bg-emerald-50",
          iconColor: "text-emerald-600",
          pillBg: "bg-emerald-50",
          pillText: "text-emerald-700",
        },
        {
          key: "on_hold",
          label: "On Hold",
          icon: Clock,
          iconBg: "bg-slate-100",
          iconColor: "text-slate-600",
          pillBg: "bg-slate-100",
          pillText: "text-slate-600",
        },
      ]}
      designPreview={(r) => {
        const designId =
          r.first_line?.design_id && Array.isArray(r.first_line.design_id)
            ? r.first_line.design_id[0]
            : null;
        if (!designId) return null;
        return (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/catalog/designs/${designId}/image`}
            alt="Design"
            className="h-12 w-12 rounded-md object-cover ring-1 ring-slate-200"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        );
      }}
      columns={[
        {
          key: "preview",
          label: "Design",
          render: (r) => {
            const designId =
              r.first_line?.design_id && Array.isArray(r.first_line.design_id)
                ? r.first_line.design_id[0]
                : null;
            const label =
              r.first_line?.design_id && Array.isArray(r.first_line.design_id)
                ? r.first_line.design_id[1]
                : "—";
            return (
              <div className="flex items-center gap-2.5">
                {designId ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`/api/catalog/designs/${designId}/image`}
                    alt={label}
                    className="h-10 w-10 flex-none rounded-md object-cover ring-1 ring-slate-200"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-slate-100 text-[10px] text-slate-400">
                    —
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs font-bold text-indigo-700">
                    {label}
                  </div>
                  <div className="truncate text-[10px] text-slate-500">
                    {r.first_line?.color ?? "—"}
                  </div>
                </div>
              </div>
            );
          },
        },
        {
          key: "company",
          label: "Company",
          render: (r) => (
            <span className="font-medium uppercase text-slate-700">
              {(r.dealer_id && Array.isArray(r.dealer_id) && r.dealer_id[1]) || "—"}
            </span>
          ),
        },
        {
          key: "sqf",
          label: "SQF",
          align: "right",
          render: (r) => (
            <span className="font-mono">{fmtNum(r.total_sqf)}</span>
          ),
        },
        {
          key: "sides",
          label: "Lados",
          align: "right",
          render: (r) => (
            <span
              className="font-mono font-semibold text-indigo-700"
              title="Sides to paint (per-piece setting on order line)"
            >
              {r.first_line?.paint_sides ?? 2}
            </span>
          ),
        },
        {
          key: "rate",
          label: "Price / SQF",
          align: "right",
          render: () => `$${PAINT_RATE.toFixed(2)}`,
        },
        {
          key: "total",
          label: "Total",
          align: "right",
          render: (r) => (
            <span className="font-bold text-emerald-700">
              {fmtMoney((r.total_sqf || 0) * PAINT_RATE)}
            </span>
          ),
        },
      ]}
    />
  );
}
