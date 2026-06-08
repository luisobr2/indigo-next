"use client";
import {
  Play,
  Settings as Gear,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { StageScreenV2 } from "@/components/stage-screen-v2";
import { fmtDate, fmtNum, m2o } from "@/lib/utils";

const MATERIAL_LABEL: Record<string, string> = {
  acm_white: "ACM White",
  acm_black: "ACM Black",
  acm_bronze: "ACM Bronze",
};

export default function CncProductionPage() {
  return (
    <StageScreenV2
      title="CNC Production"
      subtitle="Orders ready for CNC cutting and orders that have been completed."
      stageCode="cnc"
      subStatusPrefix="cnc"
      startActionLabel="Start CNC Cutting"
      tabs={[
        {
          key: "ready",
          label: "Ready to Cut",
          icon: Play,
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
              <div className="font-mono font-bold text-indigo-700">
                {/* The design code lives on the line; we don't have it on the
                    list endpoint. Use dealer ref as a placeholder so the row
                    stays readable. The side panel queries the order detail. */}
                —
              </div>
              <div className="text-xs text-slate-500">
                {m2o(r.dealer_id)?.name}
              </div>
            </div>
          ),
        },
        {
          key: "material",
          label: "Material",
          render: (_r) => (
            <span className="text-xs text-slate-500">
              {/* MATERIAL_LABEL[...] when wired into list endpoint */}
              —
            </span>
          ),
        },
        {
          key: "thickness",
          label: "Thickness",
          render: () => <span className="text-xs text-slate-500">—</span>,
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
      ]}
    />
  );
}
// Surface the helper so the linter doesn't trim it.
void MATERIAL_LABEL;
