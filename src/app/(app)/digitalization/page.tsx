"use client";
import { Tag } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StageScreenV2 } from "@/components/stage-screen-v2";
import { SendToDesignerControl } from "@/components/send-to-designer-control";
import { fmtDate } from "@/lib/utils";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";

const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "Single Door",
  DD: "Double Door",
  sidelite: "Door with Sidelites",
};

/**
 * Majela's counter (docs/majela/audio-1-digitalizacion.md): "de las 8,
 * hiciste 6, te quedan 2". Replaces the old "In Progress / Completed /
 * On Hold" tiles — those were unreachable (nothing in this screen ever
 * set digi_started_at/digi_done_at), which is what she circled in green.
 */
function DigitalizationProgress() {
  const { data } = useQuery<{ remaining: number; sent: number; total: number }>({
    queryKey: ["digitalization-progress"],
    queryFn: () => fetch("/api/orders/digitalization-progress").then((r) => r.json()),
    refetchInterval: 60_000,
  });
  if (!data) {
    return <p className="text-sm text-slate-400">Cargando progreso del día…</p>;
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      <span className="text-2xl font-bold tabular-nums text-slate-900">
        {data.total}
      </span>
      <span className="text-slate-500">en total</span>
      <span className="text-slate-300">·</span>
      <span className="text-lg font-bold tabular-nums text-emerald-600">
        {data.sent}
      </span>
      <span className="text-slate-500">enviadas</span>
      <span className="text-slate-300">·</span>
      <span className="text-lg font-bold tabular-nums text-amber-600">
        {data.remaining}
      </span>
      <span className="text-slate-500">faltan</span>
      <span className="ml-1 text-xs text-slate-400">(hoy)</span>
    </div>
  );
}

export default function DigitalizationPage() {
  const qc = useQueryClient();

  function refreshAfterSend() {
    qc.invalidateQueries({ queryKey: ["stage-v2"] });
    qc.invalidateQueries({ queryKey: ["stage-v2-stats"] });
    qc.invalidateQueries({ queryKey: ["digitalization-progress"] });
  }

  return (
    <StageScreenV2
      title="Digitalization"
      subtitle="Orders waiting on the Ficha de orden — send it to the designer to route them to CNC."
      stageCode="ready_digitalization"
      includeLines
      tabs={[]}
      summary={<DigitalizationProgress />}
      columns={[
        {
          key: "design",
          label: "Design",
          render: (r) => {
            const code =
              r.first_line?.design_id && Array.isArray(r.first_line.design_id)
                ? r.first_line.design_id[1]
                : "—";
            const doorType = r.first_line?.door_type ?? "";
            return (
              <div>
                <div className="font-mono font-bold text-indigo-700">{code}</div>
                <div className="text-xs text-slate-500">
                  {DOOR_TYPE_LABEL[doorType] ?? doorType ?? ""}
                  {doorType ? " · " : ""}
                  {r.door_count} {r.door_count === 1 ? "door" : "doors"}
                </div>
              </div>
            );
          },
        },
        {
          key: "designer",
          label: "Designer",
          render: (r) => (
            <SendToDesignerControl
              orderId={r.id}
              currentDesignerId={r.designer_id}
              onSuccess={refreshAfterSend}
            />
          ),
        },
        {
          key: "due",
          label: "Due Date",
          sortField: "expected_completion_date",
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
