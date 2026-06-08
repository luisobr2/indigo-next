"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Calendar, LogOut, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDate, m2o } from "@/lib/utils";
import { Pagination } from "@/components/pagination";

interface InstallOrder {
  id: number;
  name: string;
  client_name: string;
  client_address: string;
  client_phone: string;
  installation_date: string | false;
  door_count: number;
  dealer_id: [number, string] | false;
  stage_id: [number, string] | false;
  on_hold: boolean;
}

export default function InstallerListPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useQuery<{ records: InstallOrder[]; total: number }>({
    queryKey: ["installer", debouncedQ, page],
    queryFn: () => {
      const url = new URL("/api/orders", window.location.origin);
      url.searchParams.set("stages", "ready_install,install_scheduled");
      if (debouncedQ) url.searchParams.set("q", debouncedQ);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(page * PAGE_SIZE));
      return fetch(url).then((r) => r.json());
    },
    placeholderData: (prev) => prev,
  });

  const orders = data?.records ?? [];
  const total = data?.total ?? 0;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-indigo-700 px-4 py-3 text-white shadow">
        <h1 className="text-base font-bold">My installations</h1>
        <button
          onClick={logout}
          className="ml-auto flex items-center gap-1 text-xs opacity-90"
        >
          <LogOut size={14} />
          Log out
        </button>
      </header>

      <div className="px-4 py-4">
        <div className="relative mb-4">
          <Search
            size={18}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            placeholder="Search order # or customer name..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            className="w-full rounded-2xl border-2 border-indigo-100 bg-white py-3 pl-11 pr-4 text-base outline-none focus:border-indigo-500"
          />
        </div>

        {isLoading && (
          <p className="py-12 text-center text-sm text-slate-400">Loading...</p>
        )}

        {!isLoading && orders.length === 0 && (
          <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500">
            No orders assigned to you.
          </p>
        )}

        <div className="space-y-3">
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/installs/${o.id}`}
              className="block rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm transition hover:shadow-md"
            >
              <div className="mb-2 flex items-center gap-2">
                <strong className="text-indigo-700">{o.name}</strong>
                {o.on_hold && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                    On hold
                  </span>
                )}
                <span className="ml-auto rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
                  {m2o(o.stage_id)?.name}
                </span>
              </div>
              <div className="font-semibold text-slate-800">{o.client_name}</div>
              {o.client_address && (
                <div className="mb-1 whitespace-pre-line text-sm text-slate-500">
                  {o.client_address}
                </div>
              )}
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span>{o.door_count} doors</span>
                {m2o(o.dealer_id) && (
                  <span className="italic">{m2o(o.dealer_id)!.name}</span>
                )}
                {o.installation_date && (
                  <span className="ml-auto flex items-center gap-1 text-indigo-700">
                    <Calendar size={12} />
                    {fmtDate(o.installation_date as string)}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-4 overflow-hidden rounded-xl bg-white">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            hideOnSinglePage
          />
        </div>
      </div>
    </div>
  );
}
