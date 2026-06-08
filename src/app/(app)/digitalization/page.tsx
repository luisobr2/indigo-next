"use client";
import Link from "next/link";
import { StageScreen } from "@/components/stage-screen";
import { fmtDate, fmtNum } from "@/lib/utils";

export default function DigitalizationPage() {
  return (
    <StageScreen
      title="Digitalization"
      subtitle="Confirmed orders ready to be digitalized and prepared for CNC production."
      stageCode="ready_digitalization"
      advanceWizard="indigo.sqf.entry.wizard"
      advanceLabel="Start Digitalization"
      kpis={[
        { label: "Ready to Digitalize", code: "ready_digitalization", color: "#1f4486" },
        { label: "In Progress", code: "all", color: "#3b82f6" },
        { label: "Completed", code: "cnc", color: "#10b981" },
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
          label: "Client / Name",
          render: (r) => (
            <div>
              <div className="font-medium">{r.client_name}</div>
              <div className="text-xs text-slate-500">{r.client_address}</div>
            </div>
          ),
        },
        {
          key: "door_count",
          label: "Doors",
          align: "right",
          render: (r) => fmtNum(r.door_count),
        },
        {
          key: "total_sqf",
          label: "SQF",
          align: "right",
          render: (r) => fmtNum(r.total_sqf),
        },
        {
          key: "expected_completion_date",
          label: "Due Date",
          render: (r) => fmtDate(r.expected_completion_date as string),
        },
      ]}
    />
  );
}
