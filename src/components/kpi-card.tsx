import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon | React.ComponentType<{ size?: number; className?: string }>;
  iconColor?: string;
  iconBg?: string;
  /** One short line under the number ("in queue", "3 days worked"). */
  hint?: string;
  trend?: { value: number; label?: string };
  /** When provided, the whole card becomes a clickable link to this route. */
  href?: string;
  className?: string;
}

/**
 * The one number tile of the staff app: icon on the left, label, number and
 * an optional hint. Dashboard, Installations, Installers, Reports and Catalog
 * each drew their own (icon on top on one, on the right on another, three
 * number sizes), which is most of what made the screens look like different
 * apps. The stage screens' clickable tiles use the same proportions.
 *
 * Compact on a phone: the icon shrinks and the hint hides, so a row of tiles
 * doesn't cost a screen of scrolling before the first order.
 */
export function KpiCard({
  label,
  value,
  icon: Icon,
  iconColor = "text-indigo-700",
  iconBg = "bg-indigo-50",
  hint,
  trend,
  href,
  className,
}: KpiCardProps) {
  const positive = (trend?.value ?? 0) >= 0;
  const body = (
    <div className="flex items-center gap-2 sm:items-start sm:gap-3">
      <span
        className={cn(
          "flex h-9 w-9 flex-none items-center justify-center rounded-lg sm:h-12 sm:w-12 sm:rounded-xl",
          iconBg,
        )}
      >
        <Icon size={16} className={cn(iconColor, "sm:hidden")} />
        <Icon size={20} className={cn(iconColor, "hidden sm:block")} />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-medium leading-tight text-slate-500 sm:text-xs">{label}</div>
        <div className="text-xl font-bold leading-tight tabular-nums text-slate-900 sm:mt-0.5 sm:text-2xl">
          {value}
        </div>
        {hint && (
          <div className="hidden truncate text-[10px] uppercase tracking-wide text-slate-400 sm:block">
            {hint}
          </div>
        )}
        {trend && (
          <div className="mt-1 flex items-center gap-1 text-xs">
            {positive ? (
              <ArrowUpRight size={14} className="text-emerald-600" />
            ) : (
              <ArrowDownRight size={14} className="text-rose-600" />
            )}
            <span className={cn("font-semibold", positive ? "text-emerald-600" : "text-rose-600")}>
              {positive ? "+" : ""}
              {trend.value}%
            </span>
            <span className="text-slate-400">{trend.label ?? "vs last week"}</span>
          </div>
        )}
      </div>
    </div>
  );

  const baseCls = cn(
    "rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-slate-100 transition sm:p-4",
    href &&
      "block cursor-pointer hover:ring-indigo-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={baseCls}>
        {body}
      </Link>
    );
  }
  return <div className={baseCls}>{body}</div>;
}
