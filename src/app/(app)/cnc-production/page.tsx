"use client";
import {
  Play,
  Settings as Gear,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { StageScreenV2 } from "@/components/stage-screen-v2";
import { fmtDate, fmtNum } from "@/lib/utils";

const MATERIAL_LABEL: Record<string, string> = {
  acm_white: "ACM White",
  acm_black: "ACM Black",
  acm_bronze: "ACM Bronze",
};

const THICKNESS_LABEL: Record<string, string> = {
  "3mm": "3mm",
  "4mm": "4mm",
  "6mm": "6mm",
};

const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "Single Door",
  DD: "Double Door",
  SDL: "Door with Sidelites",
};

export default function CncProductionPage() {
  return (
    <StageScreenV2
      title="CNC Production"
      subtitle="Orders ready for CNC cutting and orders that have been completed."
      stageCode="cnc"
      subStatusPrefix="cnc"
      includeLines
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
          render: (r) => {
            const code =
              r.first_line?.design_id &&
              Array.isArray(r.first_line.design_id)
                ? r.first_line.design_id[1]
                : "—";
            const doorType = r.first_line?.door_type ?? "";
            return (
              <div>
                <div className="font-mono font-bold text-indigo-700">{code}</div>
                <div className="text-xs text-slate-500">
                  {DOOR_TYPE_LABEL[doorType] ?? doorType ?? "—"}
                </div>
              </div>
            );
          },
        },
        {
          key: "material",
          label: "Material",
          render: (r) => (
            <span className="text-sm text-slate-700">
              {MATERIAL_LABEL[r.first_line?.material ?? ""] ?? "—"}
            </span>
          ),
        },
        {
          key: "thickness",
          label: "Thickness",
          render: (r) => (
            <span className="font-mono text-sm text-slate-700">
              {THICKNESS_LABEL[r.first_line?.thickness ?? ""] ?? "—"}
            </span>
          ),
        },
        {
          key: "sqf",
          label: "SQFT",
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
