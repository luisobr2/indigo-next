"use client";
import Link from "next/link";
import { StageScreen } from "@/components/stage-screen";
import { m2o, fmtDate, fmtNum } from "@/lib/utils";

export default function DesignApprovalPage() {
  return (
    <StageScreen
      title="Design Approval"
      subtitle="Review and approve door designs before releasing to the next stage."
      stageCode={["design_pending", "design_confirmed"]}
      kpis={[
        { label: "All", code: "all", color: "#1f4486" },
        {
          label: "Pending",
          code: "design_pending",
          color: "#f59e0b",
        },
        {
          label: "Confirmed",
          code: "design_confirmed",
          color: "#10b981",
        },
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
              <div className="font-medium text-slate-800">{r.client_name}</div>
              <div className="text-xs text-slate-500">
                Ref: {m2o(r.dealer_id)?.name ?? "—"}
                {r.dealer_ref ? ` · ${r.dealer_ref}` : ""}
              </div>
            </div>
          ),
        },
        { key: "client_address", label: "Address" },
        { key: "client_phone", label: "Phone" },
        {
          key: "total_sqf",
          label: "SQF",
          align: "right",
          render: (r) => fmtNum(r.total_sqf),
        },
        {
          key: "create_date",
          label: "Created",
          render: (r) => fmtDate(r.create_date),
        },
      ]}
    />
  );
}
