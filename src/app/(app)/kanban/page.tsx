"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  AlertCircle,
  Pause,
  GripVertical,
  RefreshCw,
  Archive,
} from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, fmtNum, m2o, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/state-cards";
import { STAGE_WIZARDS } from "@/components/stage-wizard-modal";

interface Stage {
  id: number;
  name: string;
  code: string;
  sequence: number;
}

interface Card {
  id: number;
  name: string;
  stage_id: [number, string] | false;
  dealer_id: [number, string] | false;
  client_name: string;
  door_count: number;
  total_dealer_charge: number;
  days_in_current_stage: number;
  is_overdue: boolean;
  on_hold: boolean;
  payment_state: "paid" | "partial" | "unpaid";
}

interface KanbanData {
  stages: Stage[];
  cards: Card[];
}

export default function KanbanPage() {
  const qc = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [draggingOver, setDraggingOver] = useState<number | null>(null);

  // Optimistic move map: orderId -> targetStageId. Reflects the user's drag
  // before the server confirms, so the card visibly sticks where it lands.
  const [optimistic, setOptimistic] = useState<Record<number, number>>({});

  const { data, isLoading, error, refetch } = useQuery<KanbanData>({
    queryKey: ["kanban", archived],
    queryFn: async () => {
      const url = new URL("/api/kanban", window.location.origin);
      if (archived) url.searchParams.set("archived", "1");
      const r = await fetch(url);
      if (!r.ok) throw new Error("Failed to load board");
      return r.json();
    },
    refetchOnWindowFocus: false,
  });

  // Group cards by stage_id with optimistic moves applied.
  const cardsByStage = useMemo(() => {
    const out: Record<number, Card[]> = {};
    if (!data) return out;
    for (const s of data.stages) out[s.id] = [];
    for (const c of data.cards) {
      const optTarget = optimistic[c.id];
      const stageId =
        optTarget != null ? optTarget : m2o(c.stage_id)?.id ?? 0;
      if (!out[stageId]) out[stageId] = [];
      out[stageId].push(c);
    }
    return out;
  }, [data, optimistic]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(e: DragStartEvent) {
    const id = Number(e.active.id);
    const card = data?.cards.find((c) => c.id === id);
    if (card) setActiveCard(card);
  }

  function handleDragOver(e: DragOverEvent) {
    const overId = e.over?.id;
    if (typeof overId === "string" && overId.startsWith("stage-")) {
      setDraggingOver(Number(overId.replace("stage-", "")));
    } else {
      setDraggingOver(null);
    }
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    setDraggingOver(null);
    const overId = e.over?.id;
    if (!overId || typeof overId !== "string" || !overId.startsWith("stage-")) {
      return;
    }
    const targetStageId = Number(overId.replace("stage-", ""));
    const orderId = Number(e.active.id);
    const card = data?.cards.find((c) => c.id === orderId);
    if (!card) return;
    const currentStageId = m2o(card.stage_id)?.id ?? 0;
    if (currentStageId === targetStageId) return;
    const targetStage = data?.stages.find((s) => s.id === targetStageId);
    if (!targetStage) return;

    // Guard moves that bypass data capture. A kanban drag writes stage_id
    // directly, skipping the stage wizard. We confirm when:
    //   • the move skips stages (non-adjacent), or
    //   • it goes backwards, or
    //   • it advances OUT of a stage whose wizard captures required data
    //     (SQF at Digitalization, amount at Invoiced, photo/signature at
    //     Installed, photo at Painting) — even a single-step drag there
    //     would silently skip that capture.
    // A plain one-step advance out of a non-capture stage goes through with
    // no friction (that's the point of the board).
    const currentStage = data?.stages.find((s) => s.id === currentStageId);
    const gap = targetStage.sequence - (currentStage?.sequence ?? 0);
    const wizard = currentStage ? STAGE_WIZARDS[currentStage.code] : undefined;
    const nonAdjacent = Math.abs(gap) > 1;
    const backward = gap < 0;
    const skipsWizard = gap > 0 && !!wizard;
    if (nonAdjacent || backward || skipsWizard) {
      let detail: string;
      if (skipsWizard && !nonAdjacent) {
        detail = `This skips the "${wizard!.title}" step — its capture ` +
          `(photo / SQF / payment) won't be recorded. Use the order's button ` +
          `for that. Continue anyway?`;
      } else {
        const skipped = Math.abs(gap) - 1;
        detail = `This ${gap < 0 ? "moves the order BACK" : "skips " +
          skipped + " stage" + (skipped === 1 ? "" : "s") + " and"} bypasses ` +
          `the stage wizard (no photo / SQF / payment capture). Continue?`;
      }
      const ok = window.confirm(
        `Move ${card.name} from "${currentStage?.name ?? "?"}" to ` +
          `"${targetStage.name}"?\n\n${detail}`,
      );
      if (!ok) return;
    }

    // Optimistic update
    setOptimistic((prev) => ({ ...prev, [orderId]: targetStageId }));

    const promise = fetch(`/api/orders/${orderId}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage_id: targetStageId }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed");
      // Refetch to sync derived fields (days_in_current_stage resets).
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      // Clear the optimistic entry on next data tick.
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      return j;
    }).catch((err) => {
      // Roll back optimistic.
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      throw err;
    });

    toast.promise(promise, {
      loading: `Moving ${card.name}...`,
      success: `${card.name} → ${targetStage.name}`,
      error: (e) => (e instanceof Error ? e.message : "Move failed"),
    });
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load board"
        message={error instanceof Error ? error.message : "Unknown error"}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Kanban
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Drag cards between columns to advance their stage. Skips the wizard
            — for detailed transitions open the order.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setArchived((v) => !v)}
          >
            <Archive size={14} />
            {archived ? "Hide" : "Show"} archived
          </Button>
          <Button variant="outline" size="lg" onClick={() => refetch()}>
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </header>

      {/* Board */}
      <div className="flex-1 overflow-x-auto pb-3 scrollbar-thin">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex h-full gap-3 pr-3">
            {isLoading && !data && (
              <div className="flex items-center justify-center px-6 text-sm text-slate-400">
                Loading board…
              </div>
            )}
            {data?.stages.map((stage) => {
              const cards = cardsByStage[stage.id] ?? [];
              const isOver = draggingOver === stage.id;
              return (
                <KanbanColumn
                  key={stage.id}
                  stage={stage}
                  cards={cards}
                  isOver={isOver}
                />
              );
            })}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <KanbanCard card={activeCard} isOverlay />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}

function KanbanColumn({
  stage,
  cards,
  isOver,
}: {
  stage: Stage;
  cards: Card[];
  isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: `stage-${stage.id}` });
  const doors = cards.reduce((s, c) => s + (c.door_count || 0), 0);
  const value = cards.reduce((s, c) => s + (c.total_dealer_charge || 0), 0);
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-2xl border border-slate-100 bg-slate-50/60 transition",
        isOver && "border-indigo-300 bg-indigo-50/60 ring-2 ring-indigo-200",
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-800">
            {stage.name}
          </h3>
          <p className="text-[10px] text-slate-400">
            {cards.length > 0
              ? `${fmtNum(doors)} door${doors === 1 ? "" : "s"} · ${fmtMoney(value)}`
              : "—"}
          </p>
        </div>
        <Badge variant="secondary" className="ml-2 bg-white text-slate-700">
          {cards.length}
        </Badge>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2 scrollbar-thin">
        {cards.length === 0 ? (
          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-slate-200 text-[11px] text-slate-400">
            Drop here
          </div>
        ) : (
          cards.map((c) => <KanbanCard key={c.id} card={c} />)
        )}
      </div>
    </div>
  );
}

function KanbanCard({
  card,
  isOverlay,
}: {
  card: Card;
  isOverlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: card.id });
  const dealer = m2o(card.dealer_id);

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={style}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
      className={cn(
        "group rounded-xl border-l-4 border-slate-200 bg-white p-3 shadow-sm transition",
        "border-l-indigo-400",
        card.is_overdue && "border-l-rose-500",
        card.on_hold && "border-l-amber-500",
        isDragging && !isOverlay && "opacity-30",
        isOverlay && "shadow-2xl ring-2 ring-indigo-300",
      )}
    >
      <div className="flex items-start gap-1">
        <GripVertical size={12} className="mt-0.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Link
              href={`/orders/${card.id}`}
              className="font-medium text-indigo-700 hover:underline"
              // The Link click event has to bubble independently of drag
              // listeners; stopping propagation prevents dnd-kit from
              // treating the click as a drag start.
              onPointerDown={(e) => e.stopPropagation()}
            >
              {card.name}
            </Link>
            {card.is_overdue && (
              <AlertCircle size={12} className="text-rose-500" />
            )}
            {card.on_hold && (
              <Pause size={12} className="text-amber-500" />
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-800">
            {card.client_name}
          </div>
          {dealer && (
            <div className="truncate text-[11px] text-slate-500">
              {dealer.name}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between text-[10px]">
            <span
              className={cn(
                "rounded px-1 py-0.5 font-semibold tabular-nums",
                card.is_overdue || card.days_in_current_stage >= 7
                  ? "bg-rose-50 text-rose-700"
                  : card.days_in_current_stage >= 4
                    ? "bg-amber-50 text-amber-700"
                    : "text-slate-400",
              )}
            >
              {card.days_in_current_stage}d in stage
            </span>
            <span className="font-semibold tabular-nums text-slate-700">
              {fmtMoney(card.total_dealer_charge)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
            <span>{fmtNum(card.door_count)} door{card.door_count === 1 ? "" : "s"}</span>
            <Badge
              variant="secondary"
              className={cn(
                "text-[9px] font-bold uppercase",
                card.payment_state === "paid" && "bg-emerald-50 text-emerald-700",
                card.payment_state === "partial" && "bg-amber-50 text-amber-700",
                card.payment_state === "unpaid" && "bg-rose-50 text-rose-700",
              )}
            >
              {card.payment_state}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
