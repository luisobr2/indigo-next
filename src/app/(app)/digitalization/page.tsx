"use client";
import { Pencil, Settings as Gear, CheckCircle2, Clock, Tag } from "lucide-react";
import { StageScreenV2 } from "@/components/stage-screen-v2";
import { fmtDate, fmtNum } from "@/lib/utils";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";

export default function DigitalizationPage() {
  return (
    <StageScreenV2
      title="Digitalization"
      subtitle="Confirmed orders ready to be digitalized and prepared for CNC production."
      stageCode="ready_digitalization"
      subStatusPrefix="digi"
      tabs={[
        {
          key: "ready",
          label: "Ready to Digitalize",
          icon: Pencil,
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
      columns={[
        {
          key: "design",
          label: "Design",
          render: (r) => (
            <div>
              <div className="font-mono font-bold text-indigo-700">—</div>
              <div className="text-xs text-slate-500">
                {r.door_count} {r.door_count === 1 ? "door" : "doors"}
              </div>
            </div>
          ),
        },
        {
          key: "measurements",
          label: "Measurements",
          render: (r) => (
            <div className="text-xs text-slate-600">
              <div>{fmtNum(r.total_sqf)} SQF total</div>
              <div className="text-slate-400">Left/Right margins in side panel</div>
            </div>
          ),
        },
        {
          key: "sqf",
          label: "SQF",
          align: "right",
          render: (r) => fmtNum(r.total_sqf),
        },
        {
          key: "due",
          label: "Due Date",
          render: (r) => fmtDate(r.expected_completion_date as string),
        },
        {
          key: "label",
          label: "Action",
          align: "right",
          // The designer prints the 57x13 mm thermal label and pastes
          // it on the back of each cut piece. From this stage they
          // can shoot it directly to the printer with one click —
          // no need to navigate into the order detail.
          render: (r) => (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openOdooReport({
                  report: REPORTS.orderLabel,
                  ids: r.id,
                  filename: `label-${r.name || r.id}.pdf`,
                });
              }}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
              title="Print designer labels for this order"
            >
              <Tag size={12} />
              Label
            </button>
          ),
        },
      ]}
    />
  );
}
