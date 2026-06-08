"use client";
import Link from "next/link";
import { StageScreen } from "@/components/stage-screen";
import { fmtDate, fmtNum, m2o } from "@/lib/utils";

export default function InstallationsPage() {
  return (
    <StageScreen
      title="Installations"
      subtitle="Orders ready for installation or already scheduled."
      stageCode={["ready_install", "install_scheduled"]}
      advanceWizard="indigo.installed.wizard"
      advanceLabel="Mark installed"
      kpis={[
        { label: "Ready", code: "ready_install", color: "#1f4486" },
        { label: "Scheduled", code: "install_scheduled", color: "#3b82f6" },
        { label: "Installed", code: "installed", color: "#10b981" },
        { label: "On Hold", code: "on_hold", color: "#ef4444" },
      ]}
      columns={[
        {
          key: "name",
          label: "Order #",
          render: (r) => (
            <Link
              href={`/orders/${r.id}`}
              className="font-semibold text-indigo-700 hover:underline"
            >
              {r.name}
            </Link>
          ),
        },
        {
          key: "client_name",
          label: "Client / Address",
          render: (r) => (
            <div>
              <div className="font-medium">{r.client_name}</div>
              <div className="text-xs text-slate-500">{r.client_address}</div>
            </div>
          ),
        },
        { key: "client_phone", label: "Phone" },
        {
          key: "dealer_id",
          label: "Dealer",
          render: (r) => m2o(r.dealer_id)?.name ?? "—",
        },
        {
          key: "door_count",
          label: "Doors",
          align: "right",
          render: (r) => fmtNum(r.door_count),
        },
        {
          key: "installation_date",
          label: "Scheduled",
          render: (r) => fmtDate(r.installation_date as string),
        },
      ]}
    />
  );
}
