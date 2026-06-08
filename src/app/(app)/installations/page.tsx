"use client";
import { Wrench, CalendarClock, CheckCircle2, PauseCircle } from "lucide-react";
import { StageScreenV2 } from "@/components/stage-screen-v2";
import { fmtDate, fmtNum, m2o } from "@/lib/utils";

export default function InstallationsPage() {
  return (
    <StageScreenV2
      title="Installations"
      subtitle="Orders ready for installation or already scheduled."
      stageCode={["ready_install", "install_scheduled", "installed"]}
      startActionLabel="Mark Installed"
      tabs={[
        {
          key: "ready",
          label: "Ready",
          icon: Wrench,
          iconBg: "bg-sky-50",
          iconColor: "text-sky-700",
          pillBg: "bg-sky-50",
          pillText: "text-sky-700",
          stageCodes: ["ready_install"],
        },
        {
          key: "in_progress",
          label: "Scheduled",
          icon: CalendarClock,
          iconBg: "bg-amber-50",
          iconColor: "text-amber-600",
          pillBg: "bg-amber-50",
          pillText: "text-amber-700",
          stageCodes: ["install_scheduled"],
        },
        {
          key: "completed",
          label: "Installed",
          icon: CheckCircle2,
          iconBg: "bg-emerald-50",
          iconColor: "text-emerald-600",
          pillBg: "bg-emerald-50",
          pillText: "text-emerald-700",
          stageCodes: ["installed"],
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
      ]}
      columns={[
        {
          key: "phone",
          label: "Phone",
          render: (r) => r.client_phone || "—",
        },
        {
          key: "dealer",
          label: "Dealer",
          render: (r) => m2o(r.dealer_id)?.name ?? "—",
        },
        {
          key: "doors",
          label: "Doors",
          align: "right",
          render: (r) => fmtNum(r.door_count),
        },
        {
          key: "scheduled",
          label: "Scheduled",
          render: (r) => fmtDate(r.installation_date as string),
        },
      ]}
    />
  );
}
