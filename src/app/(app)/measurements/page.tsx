"use client";
import Link from "next/link";
import { StageScreen } from "@/components/stage-screen";
import { m2o, fmtDate, fmtNum } from "@/lib/utils";

export default function MeasurementsPage() {
  return (
    <StageScreen
      title="Measurements"
      subtitle="Orders awaiting measurement or with confirmed dimensions."
      stageCode={["measure_pending", "measured"]}
      advanceWizard="indigo.measurement.entry.wizard"
      advanceLabel="Start Measurements"
      kpis={[
        { label: "Pending", code: "measure_pending", color: "#f59e0b" },
        { label: "Measured", code: "measured", color: "#10b981" },
        { label: "On Hold", code: "on_hold", color: "#ef4444" },
        { label: "All", code: "all", color: "#1f4486" },
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
          key: "expected_completion_date",
          label: "Due",
          render: (r) => fmtDate(r.expected_completion_date as string),
        },
      ]}
    />
  );
}
