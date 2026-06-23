"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MapPin,
  Truck,
  Send,
  ArrowRight,
  Printer,
  GripVertical,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { fmtDate, cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { openOdooReport, REPORTS } from "@/lib/odoo-pdf";

interface RouteOrder {
  id: number;
  name: string;
  client_name: string;
  client_address: string;
  client_phone: string;
  installation_date: string | false;
  installer_ids: number[];
  dealer_id: [number, string] | false;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export default function RoutePlannerPage() {
  // The planner sequences ONE day's route. Default to today; the operator
  // can pick another date and (optionally) narrow to a single installer.
  const [day, setDay] = useState<string>(todayStr());
  const [installerId, setInstallerId] = useState<number | "">("");

  const { data, isLoading, isError } = useQuery<{ records: RouteOrder[] }>({
    queryKey: ["route-planner"],
    queryFn: () =>
      fetchJson<{ records: RouteOrder[] }>(
        "/api/orders?stages=install_scheduled,ready_install&limit=200",
      ),
  });

  const installersQ = useQuery<{ records: Array<{ id: number; name: string }> }>({
    queryKey: ["installers"],
    queryFn: () => fetchJson<{ records: Array<{ id: number; name: string }> }>("/api/installers"),
    staleTime: 5 * 60_000,
  });

  // Only the orders scheduled for the chosen day (and installer, if set).
  const records = useMemo(() => {
    const all = data?.records ?? [];
    return all.filter((r) => {
      if (!r.installation_date) return false;
      if (String(r.installation_date).slice(0, 10) !== day) return false;
      if (installerId !== "" && !(r.installer_ids || []).includes(installerId))
        return false;
      return true;
    });
  }, [data, day, installerId]);

  // Local, reorderable copy of the stops. The on-screen numbering, the
  // WhatsApp message and the printed list all follow THIS order so the
  // operator can sequence the day by customer availability.
  const [stops, setStops] = useState<RouteOrder[]>([]);
  // Order-sensitive signature: resync only when the underlying set/order
  // actually changes, so a manual reorder isn't clobbered by a refetch or
  // an unrelated re-render.
  const sig = records.map((r) => r.id).join(",");
  useEffect(() => {
    setStops(records);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setStops((items) => {
      const from = items.findIndex((x) => x.id === active.id);
      const to = items.findIndex((x) => x.id === over.id);
      if (from === -1 || to === -1) return items;
      return arrayMove(items, from, to);
    });
  }

  function nudge(index: number, dir: -1 | 1) {
    setStops((items) => {
      const to = index + dir;
      if (to < 0 || to >= items.length) return items;
      return arrayMove(items, index, to);
    });
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Route Planner
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Plan measurement and installation routes by day. Send the optimized
            stop list to the team by WhatsApp.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              if (!stops.length) {
                toast.warning("No installations scheduled");
                return;
              }
              openOdooReport({
                report: REPORTS.installationAddresses,
                ids: stops.map((o) => o.id),
                filename: `installations-${new Date().toISOString().slice(0, 10)}.pdf`,
              });
            }}
          >
            <Printer size={14} />
            Print addresses
          </Button>
          <Button
            size="lg"
            onClick={() => {
              if (!stops.length) {
                toast.warning("No installations scheduled");
                return;
              }
              // Build a WhatsApp-shareable text version of the day's stops in
              // the CURRENT (possibly reordered) sequence. We URL-encode so
              // addresses with commas/spaces survive the wa.me handler. No
              // phone prefix -> opens the contact picker on the device.
              const lines = [
                `*Indigo Decors — Installations ${fmtDate(day)}*`,
                "",
                ...stops.map((o, i) =>
                  [
                    `${i + 1}. ${o.name} — ${o.client_name}`,
                    o.client_address
                      ? `   ${o.client_address.replace(/\n/g, ", ")}`
                      : "",
                    o.client_phone ? `   📞 ${o.client_phone}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                ),
                "",
                `Total stops: ${stops.length}`,
              ].join("\n");
              const url = `https://wa.me/?text=${encodeURIComponent(lines)}`;
              window.open(url, "_blank", "noopener");
              toast.success("Opening WhatsApp...");
            }}
            className="bg-emerald-600 text-white shadow shadow-emerald-600/30 hover:bg-emerald-700"
          >
            <Send size={14} />
            Send route to WhatsApp
          </Button>
        </div>
      </div>

      {/* Day + installer filter — the planner is for ONE day's route. */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Day
          </label>
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setDay(todayStr())}
            className="text-xs font-medium text-indigo-700 hover:underline"
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Installer
          </label>
          <select
            value={installerId}
            onChange={(e) =>
              setInstallerId(e.target.value ? Number(e.target.value) : "")
            }
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-indigo-400 focus:outline-none"
          >
            <option value="">All installers</option>
            {installersQ.data?.records?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        <span className="ml-auto text-xs text-slate-400">
          {stops.length} stop{stops.length === 1 ? "" : "s"} · {fmtDate(day)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <aside className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2 font-semibold text-slate-800">
            <Truck size={16} className="text-indigo-700" />
            Stops ({stops.length})
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Drag <GripVertical size={11} className="inline -mt-0.5" /> or use
            the ↑ ↓ buttons to reorder. The order here is what gets sent to
            WhatsApp and printed.
          </p>
          {isLoading && (
            <div className="py-12 text-center text-sm text-slate-400">
              Loading...
            </div>
          )}
          {isError && (
            <div className="py-12 text-center text-sm text-rose-600">
              Couldn&apos;t load scheduled stops. Refresh to try again.
            </div>
          )}
          {!isLoading && !isError && stops.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-400">
              No installations scheduled for {fmtDate(day)}
              {installerId !== "" ? " for this installer" : ""}.
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={stops.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="space-y-2">
                {stops.map((o, i) => (
                  <SortableStop
                    key={o.id}
                    order={o}
                    index={i}
                    total={stops.length}
                    onUp={() => nudge(i, -1)}
                    onDown={() => nudge(i, 1)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        </aside>
      </div>
    </div>
  );
}

function SortableStop({
  order: o,
  index,
  total,
  onUp,
  onDown,
}: {
  order: RouteOrder;
  index: number;
  total: number;
  onUp: () => void;
  onDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: o.id });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-stretch gap-2 rounded-xl border border-slate-100 bg-white p-3",
        isDragging ? "shadow-lg ring-1 ring-indigo-200" : "hover:bg-slate-50",
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="flex cursor-grab touch-none items-center text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>

      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-700 text-xs font-bold text-white">
        {index + 1}
      </div>

      <div className="flex-1 text-sm">
        <Link
          href={`/orders/${o.id}`}
          className="font-semibold text-indigo-700 hover:underline"
        >
          {o.name}
        </Link>
        <div className="font-medium text-slate-800">{o.client_name}</div>
        <div className="flex items-start gap-1 text-xs text-slate-500">
          <MapPin size={11} className="mt-0.5 shrink-0" />
          <span className="line-clamp-2">{o.client_address}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          <span>
            {o.installation_date ? fmtDate(o.installation_date) : "No date"}
          </span>
          {index < total - 1 && (
            <ArrowRight size={10} className="text-slate-300" />
          )}
        </div>
      </div>

      {/* Up / down nudge buttons — touch-friendly alternative to dragging */}
      <div className="flex flex-col justify-center gap-1">
        <button
          type="button"
          onClick={onUp}
          disabled={index === 0}
          aria-label="Move up"
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronUp size={15} />
        </button>
        <button
          type="button"
          onClick={onDown}
          disabled={index === total - 1}
          aria-label="Move down"
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronDown size={15} />
        </button>
      </div>
    </li>
  );
}
