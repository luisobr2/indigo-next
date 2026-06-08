"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Bell,
  AlertCircle,
  Sparkles,
  Receipt,
  FileText,
  Clock,
  Truck,
  Brush,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NotifItem {
  id: string;
  type:
    | "overdue"
    | "new_order"
    | "pending_invoice"
    | "outstanding"
    | "in_my_stage"
    | "today_install"
    | "payout_draft";
  title: string;
  body?: string;
  href: string;
  severity: "info" | "warning" | "danger" | "success";
  at?: string;
  count?: number;
}

interface NotifResponse {
  items: NotifItem[];
  count: number;
  generatedAt?: string;
}

const ICON: Record<NotifItem["type"], typeof Bell> = {
  overdue: AlertCircle,
  new_order: Sparkles,
  pending_invoice: Receipt,
  outstanding: FileText,
  in_my_stage: Clock,
  today_install: Truck,
  payout_draft: Brush,
};

const SEV_COLOR: Record<NotifItem["severity"], string> = {
  info: "text-indigo-600 bg-indigo-50",
  warning: "text-amber-700 bg-amber-50",
  danger: "text-rose-600 bg-rose-50",
  success: "text-emerald-600 bg-emerald-50",
};

export function NotificationsBell() {
  const router = useRouter();
  // Poll every 60s — manager's overdue list shifts as orders age out of
  // their SLA, painter's "in my stage" updates as CNC pushes work in.
  const { data } = useQuery<NotifResponse>({
    queryKey: ["notifications"],
    queryFn: () => fetch("/api/notifications").then((r) => r.json()),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const count = data?.count ?? 0;
  const items = data?.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
        aria-label={`Notifications (${count})`}
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 inline-flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 max-w-[calc(100vw-1rem)]"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            <span className="font-semibold text-slate-800">Notifications</span>
            <span className="text-[10px] font-normal text-slate-400">
              {count} item{count === 1 ? "" : "s"}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        {items.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-400">
            🎉 All caught up — nothing needs your attention.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
            {items.map((it) => {
              const Icon = ICON[it.type] ?? Bell;
              return (
                <DropdownMenuItem
                  key={it.id}
                  onClick={() => router.push(it.href)}
                  className="flex items-start gap-3 py-2.5"
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${SEV_COLOR[it.severity]}`}
                  >
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-800">
                      {it.title}
                    </div>
                    {it.body && (
                      <div className="truncate text-[11px] text-slate-500">
                        {it.body}
                      </div>
                    )}
                  </div>
                </DropdownMenuItem>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
