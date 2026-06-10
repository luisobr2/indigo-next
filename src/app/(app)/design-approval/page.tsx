"use client";
import Link from "next/link";
import { Clock, CheckCircle2, AlertCircle, PauseCircle } from "lucide-react";
import { StageScreenV2 } from "@/components/stage-screen-v2";
import { PhoneLink } from "@/components/address-link";
import { QuickStageActionButton } from "@/components/quick-stage-action-button";
import { m2o, fmtDate, fmtNum } from "@/lib/utils";

export default function DesignApprovalPage() {
  return (
    <StageScreenV2
      title="Design Approval"
      subtitle="Review and approve door designs before releasing to the next stage."
      stageCode={["design_pending", "design_confirmed"]}
      tabs={[
        {
          key: "ready",
          label: "Pending",
          icon: Clock,
          iconBg: "bg-amber-50",
          iconColor: "text-amber-600",
          pillBg: "bg-amber-50",
          pillText: "text-amber-700",
          stageCodes: ["design_pending"],
        },
        {
          key: "completed",
          label: "Confirmed",
          icon: CheckCircle2,
          iconBg: "bg-emerald-50",
          iconColor: "text-emerald-600",
          pillBg: "bg-emerald-50",
          pillText: "text-emerald-700",
          stageCodes: ["design_confirmed"],
        },
        {
          key: "on_hold",
          label: "On Hold",
          icon: PauseCircle,
          iconBg: "bg-slate-100",
          iconColor: "text-slate-600",
          pillBg: "bg-slate-100",
          pillText: "text-slate-600",
        },
        {
          key: "cancelled",
          label: "Cancelled",
          icon: AlertCircle,
          iconBg: "bg-rose-50",
          iconColor: "text-rose-600",
          pillBg: "bg-rose-50",
          pillText: "text-rose-700",
        },
      ]}
      columns={[
        {
          key: "dealer",
          label: "Dealer",
          render: (r) => (
            <div className="text-sm">
              <div className="font-medium">{m2o(r.dealer_id)?.name ?? "—"}</div>
              {r.dealer_ref ? (
                <div className="text-xs text-slate-500">Ref: {r.dealer_ref}</div>
              ) : null}
            </div>
          ),
        },
        {
          key: "phone",
          label: "Phone",
          render: (r) => <PhoneLink phone={r.client_phone} />,
        },
        {
          key: "sqf",
          label: "SQF",
          align: "right",
          render: (r) => fmtNum(r.total_sqf),
        },
        {
          key: "created",
          label: "Created",
          render: (r) => fmtDate(r.create_date),
        },
        {
          key: "quick",
          label: "Action",
          align: "right",
          // Inline 1-click confirm: design_pending → design_confirmed.
          // Only meaningful on the Pending tab — once confirmed the row
          // moves off this stage so the button never duplicates work.
          render: (r) =>
            r.stage_code === "design_pending" ? (
              <QuickStageActionButton
                orderId={r.id}
                targetStageCode="design_confirmed"
                label="Confirm"
                loadingVerb="Confirming design"
              />
            ) : null,
        },
      ]}
    />
  );
}
// link export silences linter
void Link;
