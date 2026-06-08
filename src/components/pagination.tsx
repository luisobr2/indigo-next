"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PaginationProps {
  /** 0-indexed page number */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (next: number) => void;
  onPageSizeChange?: (next: number) => void;
  pageSizes?: number[];
  /** Hide when total fits in a single page. Defaults to true. */
  hideOnSinglePage?: boolean;
}

/**
 * Generic Previous/Next pagination strip with a "Showing X-Y of Z" hint
 * and an optional page-size picker. Designed to sit below a table or
 * card list.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = [25, 50, 100, 200],
  hideOnSinglePage = true,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (hideOnSinglePage && total <= pageSize) return null;

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-3 py-2.5 text-xs text-slate-600 sm:px-4">
      <div className="flex items-center gap-3">
        <span className="tabular-nums">
          Showing <strong className="text-slate-900">{from}</strong>–
          <strong className="text-slate-900">{to}</strong> of{" "}
          <strong className="text-slate-900">{total}</strong>
        </span>
        {onPageSizeChange && (
          <div className="hidden items-center gap-1.5 sm:flex">
            <span className="text-slate-400">Per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
            >
              <SelectTrigger className="h-7 w-[78px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizes.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(0)}
          disabled={page === 0}
          aria-label="First page"
        >
          <ChevronsLeft size={14} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </Button>
        <span className="px-2 tabular-nums">
          Page <strong className="text-slate-900">{page + 1}</strong> /{" "}
          {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(totalPages - 1)}
          disabled={page >= totalPages - 1}
          aria-label="Last page"
        >
          <ChevronsRight size={14} />
        </Button>
      </div>
    </div>
  );
}
