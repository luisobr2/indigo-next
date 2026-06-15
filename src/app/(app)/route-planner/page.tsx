"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Map,
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

export default function RoutePlannerPage() {
  const { data, isLoading } = useQuery<{ records: RouteOrder[] }>({
    queryKey: ["route-planner"],
    queryFn: () =>
      fetch("/api/orders?stages=install_scheduled,ready_install&limit=50").then(
        (r) => r.json(),
      ),
  });

  // Local, reorderable copy of the stops. The on-screen numbering, the
  // WhatsApp message and the printed list all follow THIS order so the
  // operator can sequence the day by customer availability.
  const [stops, setStops] = useState<RouteOrder[]>([]);
  const records = data?.records ?? [];
  // Order-sensitive signature: resync only when the underlying set/order
  // from the server actually changes, so a manual reorder isn't clobbered
  // by a background refetch that returns the same stops.
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
                "*Indigo Decors — Today's installations*",
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-2 font-semibold text-slate-800">
            <Map size={16} className="text-indigo-700" />
            Route map
          </div>
          <div className="relative flex h-[450px] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 via-blue-50 to-slate-100">
            <div className="text-center">
              <Map className="mx-auto mb-3 text-slate-300" size={48} />
              <p className="text-sm font-medium text-slate-500">
                Mapbox integration pending — set NEXT_PUBLIC_MAPBOX_TOKEN
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Showing fallback placeholder. Stops list visible on the right.
              </p>
            </div>
          </div>
        </div>

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
          {!isLoading && stops.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-400">
              Nothing scheduled.
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
