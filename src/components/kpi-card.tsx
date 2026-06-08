import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  trend?: { value: number; label?: string };
  href?: string;
  className?: string;
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  iconColor = "text-indigo-700",
  iconBg = "bg-indigo-50",
  trend,
  className,
}: KpiCardProps) {
  const positive = (trend?.value ?? 0) >= 0;
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className={cn("rounded-2xl p-3", iconBg)}>
          <Icon size={20} className={iconColor} />
        </div>
        <span className="text-sm text-slate-400">{label}</span>
      </div>
      <div className="mt-3 text-3xl font-bold text-slate-900">{value}</div>
      {trend && (
        <div className="mt-2 flex items-center gap-1 text-xs">
          {positive ? (
            <ArrowUpRight size={14} className="text-emerald-600" />
          ) : (
            <ArrowDownRight size={14} className="text-rose-600" />
          )}
          <span
            className={cn(
              "font-semibold",
              positive ? "text-emerald-600" : "text-rose-600",
            )}
          >
            {positive ? "+" : ""}
            {trend.value}%
          </span>
          <span className="text-slate-400">{trend.label ?? "vs last week"}</span>
        </div>
      )}
    </div>
  );
}
