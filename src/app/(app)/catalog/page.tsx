"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Boxes, Building2, Pencil, Plus, Search } from "lucide-react";
import { fmtMoney } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Design {
  id: number;
  code: string;
  name: string;
  description?: string;
  door_type?: string;
  active?: boolean;
}

interface Dealer {
  id: number;
  name: string;
  indigo_default_price_per_sqf?: number;
  active?: boolean;
}

export default function CatalogPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const designs = useQuery<{ records: Design[]; total: number }>({
    queryKey: ["catalog-designs", debouncedQ, page, pageSize],
    queryFn: () => {
      const url = new URL("/api/catalog/designs", window.location.origin);
      if (debouncedQ) url.searchParams.set("q", debouncedQ);
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(page * pageSize));
      return fetch(url).then((r) => r.json());
    },
    placeholderData: (prev) => prev,
  });
  const dealers = useQuery<{ records: Dealer[] }>({
    queryKey: ["catalog-dealers"],
    queryFn: () => fetch("/api/catalog/dealers").then((r) => r.json()),
  });

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">
        Catalog
      </h1>

      {/* Dealers */}
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Building2 size={18} className="text-indigo-700" />
          <h2 className="font-semibold text-slate-800">Dealers</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(dealers.data?.records ?? []).map((d) => (
            <Link
              key={d.id}
              href={`/catalog/dealers/${d.id}`}
              className="flex items-center justify-between rounded-xl border border-slate-100 p-4 transition hover:border-indigo-200 hover:bg-indigo-50/30"
            >
              <div>
                <div className="font-bold uppercase text-indigo-700">{d.name}</div>
                <div className="text-xs text-slate-500">
                  Default: {fmtMoney(d.indigo_default_price_per_sqf)} / SQF
                </div>
              </div>
              <Pencil size={14} className="text-slate-400" />
            </Link>
          ))}
        </div>
      </section>

      {/* Designs */}
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Boxes size={18} className="text-indigo-700" />
            <h2 className="font-semibold text-slate-800">
              Designs ({designs.data?.total ?? 0})
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by code or name…"
                className="pl-9"
              />
            </div>
            <Link
              href="/catalog/designs/new"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-indigo-700 px-4 text-sm font-semibold text-white shadow shadow-indigo-700/30 transition hover:bg-indigo-800"
            >
              <Plus size={14} />
              New design
            </Link>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-100">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Code</th>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Door Type</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {(designs.data?.records ?? []).map((d) => (
                  <tr
                    key={d.id}
                    className="border-t border-slate-100 transition hover:bg-indigo-50/30"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/catalog/designs/${d.id}`}
                        className="font-mono font-bold text-indigo-700 hover:underline"
                      >
                        {d.code}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/catalog/designs/${d.id}`}
                        className="text-slate-800 hover:text-indigo-700"
                      >
                        {d.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{d.door_type}</td>
                    <td className="px-4 py-2.5 text-right">
                      {d.active === false && (
                        <Badge variant="secondary" className="bg-amber-50 text-amber-700">
                          Archived
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={designs.data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(0);
            }}
          />
        </div>
      </section>
    </div>
  );
}
