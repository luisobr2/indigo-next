"use client";

import { Columns3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

export interface ColumnOption {
  key: string;
  label: string;
}

/**
 * Shared "Columns" show/hide dropdown used by the table pages. Wraps Base UI
 * correctly (label inside a Group; checkbox items keep the menu open).
 */
export function ColumnsMenu({
  columns,
  visible,
  onToggle,
  triggerClassName,
}: {
  columns: ColumnOption[];
  visible: string[];
  onToggle: (key: string) => void;
  triggerClassName?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          triggerClassName ??
          "inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none"
        }
      >
        <Columns3 size={14} /> Columns
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Columns
          </DropdownMenuLabel>
          {columns.map((c) => (
            <DropdownMenuCheckboxItem
              key={c.key}
              checked={visible.includes(c.key)}
              closeOnClick={false}
              onCheckedChange={() => onToggle(c.key)}
            >
              {c.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
