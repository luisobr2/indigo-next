"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Mail, Phone, MapPin, Save } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, fmtMoney, m2o } from "@/lib/utils";
import { ErrorState } from "@/components/state-cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DealerDto {
  id: number;
  name: string;
  email: string | false;
  phone: string | false;
  street: string | false;
  city: string | false;
  zip: string | false;
  indigo_default_price_per_sqf: number;
  active: boolean;
}

interface DealerOrder {
  id: number;
  name: string;
  client_name: string;
  stage_id: [number, string] | false;
  total_dealer_charge: number;
  create_date: string;
}

export default function DealerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  const isNew = idStr === "new";
  const id = isNew ? 0 : Number(idStr);
  const qc = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery<{
    dealer: DealerDto;
    orders: DealerOrder[];
  }>({
    queryKey: ["dealer", idStr],
    queryFn: () => fetch(`/api/catalog/dealers/${id}`).then((r) => r.json()),
    enabled: !isNew,
  });

  // Edit form state — synced from server data on first arrival.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew || !data?.dealer) return;
    const d = data.dealer;
    setName(d.name ?? "");
    setEmail((d.email as string) || "");
    setPhone((d.phone as string) || "");
    setStreet((d.street as string) || "");
    setCity((d.city as string) || "");
    setZip((d.zip as string) || "");
    setPrice(d.indigo_default_price_per_sqf?.toString() ?? "0");
  }, [data, isNew]);

  async function save() {
    if (!name) {
      toast.error("Name is required");
      return;
    }
    setBusy(true);
    const body = {
      name,
      email: email || false,
      phone: phone || false,
      street: street || false,
      city: city || false,
      zip: zip || false,
      indigo_default_price_per_sqf: parseFloat(price) || 0,
    };
    const promise = (
      isNew
        ? fetch(`/api/catalog/dealers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }).then(async (r) => {
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || "Create failed");
            qc.invalidateQueries({ queryKey: ["catalog-dealers"] });
            router.replace(`/catalog/dealers/${j.id}`);
            return j;
          })
        : fetch(`/api/catalog/dealers/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }).then(async (r) => {
            const j = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || "Save failed");
            qc.invalidateQueries({ queryKey: ["dealer", idStr] });
            qc.invalidateQueries({ queryKey: ["catalog-dealers"] });
            return j;
          })
    ).finally(() => setBusy(false));

    toast.promise(promise, {
      loading: isNew ? "Creating dealer..." : "Saving dealer...",
      success: isNew ? `${name} created` : `${name} saved`,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });
  }

  if (!isNew && isLoading)
    return <div className="p-12 text-center text-slate-400">Loading...</div>;
  if (!isNew && !data?.dealer)
    return (
      <ErrorState
        title="Dealer not found"
        message={`Dealer #${idStr} doesn't exist or you don't have permission to see it.`}
        backHref="/catalog"
      />
    );

  return (
    <div className="mx-auto max-w-[1300px] space-y-5">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/catalog" className="hover:text-indigo-700">
          Catalog
        </Link>
        <span>&rsaquo;</span>
        <span className="font-medium text-slate-800">
          {isNew ? "New dealer" : data?.dealer.name}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/catalog" className="rounded-xl p-1.5 hover:bg-slate-100">
          <ArrowLeft size={18} className="text-slate-500" />
        </Link>
        <Building2 size={28} className="text-indigo-700" />
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {isNew ? "New dealer" : data?.dealer.name}
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section
          className={`rounded-2xl border border-slate-100 bg-white p-5 shadow-sm ${
            isNew ? "lg:col-span-3" : "lg:col-span-2"
          }`}
        >
          <h2 className="mb-4 font-semibold text-slate-800">Dealer info</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Name">
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lock Tight"
                className="h-10"
              />
            </Field>
            <Field label="Default price / SQF (USD)">
              <Input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="h-10"
              />
            </Field>
            <Field label="Email" icon={<Mail size={12} />}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10"
              />
            </Field>
            <Field label="Phone" icon={<Phone size={12} />}>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-10"
              />
            </Field>
            <Field label="Street" icon={<MapPin size={12} />}>
              <Input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                className="h-10"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <Input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="h-10"
                />
              </Field>
              <Field label="ZIP">
                <Input
                  type="text"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  className="h-10"
                />
              </Field>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-3">
            <Button
              type="button"
              size="lg"
              onClick={save}
              disabled={busy}
            >
              <Save size={14} />
              {busy
                ? isNew
                  ? "Creating..."
                  : "Saving..."
                : isNew
                  ? "Create dealer"
                  : "Save changes"}
            </Button>
          </div>
        </section>

        {!isNew && data && (
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-semibold text-slate-800">
              Recent orders ({data.orders.length})
            </h2>
            {data.orders.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-400">
                No active orders.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.orders.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/orders/${o.id}`}
                      className="block rounded-xl border border-slate-100 p-3 text-sm transition hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between">
                        <strong className="text-indigo-700">{o.name}</strong>
                        <span className="text-xs text-slate-500">
                          {fmtDate(o.create_date)}
                        </span>
                      </div>
                      <div className="text-slate-700">{o.client_name}</div>
                      <div className="mt-1 flex items-center justify-between text-xs">
                        <span className="text-slate-500">
                          {m2o(o.stage_id)?.name}
                        </span>
                        <span className="font-semibold text-emerald-700">
                          {fmtMoney(o.total_dealer_charge)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}
