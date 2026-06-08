"use client";

import { useQuery } from "@tanstack/react-query";
import { Map, MapPin, Truck, Send, ArrowRight, Printer } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { fmtDate, m2o } from "@/lib/utils";
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

  const orders = data?.records ?? [];

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
            if (!orders.length) {
              toast.warning("No installations scheduled");
              return;
            }
            openOdooReport({
              report: REPORTS.installationAddresses,
              ids: orders.map((o) => o.id),
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
            if (!orders.length) {
              toast.warning("No installations scheduled");
              return;
            }
            // Build a WhatsApp-shareable text version of the day's stops.
            // We URL-encode so addresses with commas/spaces survive the
            // wa.me handler. No phone number prefix -> opens the contact
            // picker on the device so the user picks the installer.
            const lines = [
              "*Indigo Decors — Today's installations*",
              "",
              ...orders.map((o, i) =>
                [
                  `${i + 1}. ${o.name} — ${o.client_name}`,
                  o.client_address ? `   ${o.client_address.replace(/\n/g, ", ")}` : "",
                  o.client_phone ? `   📞 ${o.client_phone}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              ),
              "",
              `Total stops: ${orders.length}`,
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
          <div className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
            <Truck size={16} className="text-indigo-700" />
            Stops ({orders.length})
          </div>
          {isLoading && (
            <div className="py-12 text-center text-sm text-slate-400">
              Loading...
            </div>
          )}
          {!isLoading && orders.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-400">
              Nothing scheduled.
            </div>
          )}
          <ol className="space-y-2">
            {orders.map((o, i) => (
              <li
                key={o.id}
                className="flex gap-3 rounded-xl border border-slate-100 p-3 hover:bg-slate-50"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-700 text-xs font-bold text-white">
                  {i + 1}
                </div>
                <div className="flex-1 text-sm">
                  <Link
                    href={`/orders/${o.id}`}
                    className="font-semibold text-indigo-700 hover:underline"
                  >
                    {o.name}
                  </Link>
                  <div className="font-medium text-slate-800">
                    {o.client_name}
                  </div>
                  <div className="flex items-start gap-1 text-xs text-slate-500">
                    <MapPin size={11} className="mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{o.client_address}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                    <span>{fmtDate(o.installation_date as string)}</span>
                    {i < orders.length - 1 && (
                      <ArrowRight size={10} className="text-slate-300" />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
