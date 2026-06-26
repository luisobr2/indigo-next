"use client";
import { Ruler, CheckCircle2, PauseCircle, AlertCircle } from "lucide-react";
import { StageScreenV2 } from "@/components/stage-screen-v2";
import { PhoneLink } from "@/components/address-link";
import { m2o, fmtDate, fmtNum } from "@/lib/utils";

export default function MeasurementsPage() {
  return (
    <StageScreenV2
      title="Measurements"
      subtitle="Orders awaiting measurement or with confirmed dimensions."
      stageCode={["measure_pending", "measured"]}
      startActionLabel="Start Measurements"
      tabs={[
        {
          key: "ready",
          label: "Pending",
          icon: Ruler,
          iconBg: "bg-amber-50",
          iconColor: "text-amber-600",
          pillBg: "bg-amber-50",
          pillText: "text-amber-700",
          stageCodes: ["measure_pending"],
        },
        {
          key: "completed",
          label: "Measured",
          icon: CheckCircle2,
          iconBg: "bg-emerald-50",
          iconColor: "text-emerald-600",
          pillBg: "bg-emerald-50",
          pillText: "text-emerald-700",
          stageCodes: ["measured"],
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
          key: "phone",
          label: "Phone",
          sortField: "client_phone",
          render: (r) => <PhoneLink phone={r.client_phone} />,
        },
        {
          key: "dealer",
          label: "Dealer",
          sortField: "dealer_id",
          render: (r) => m2o(r.dealer_id)?.name ?? "—",
        },
        {
          key: "doors",
          label: "Doors",
          align: "right",
          sortField: "door_count",
          render: (r) => fmtNum(r.door_count),
        },
        {
          key: "due",
          label: "Due",
          sortField: "expected_completion_date",
          render: (r) => fmtDate(r.expected_completion_date as string),
        },
      ]}
    />
  );
}
