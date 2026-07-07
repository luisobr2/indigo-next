"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Mail, Phone, MapPin, Save, KeyRound, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, fmtMoney, m2o } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { ErrorState } from "@/components/state-cards";
import { PhoneField } from "@/components/phone-field";
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

  const { data, isLoading, isError, error, refetch } = useQuery<{
    dealer: DealerDto;
    orders: DealerOrder[];
    portal: { has_user: boolean; login: string | false; active: boolean } | null;
  }>({
    queryKey: ["dealer", idStr],
    queryFn: () =>
      fetchJson<{
        dealer: DealerDto;
        orders: DealerOrder[];
        portal: { has_user: boolean; login: string | false; active: boolean } | null;
      }>(`/api/catalog/dealers/${id}`),
    enabled: !isNew,
    retry: 1,
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

  const [portalPw, setPortalPw] = useState("");
  const [showPortalPw, setShowPortalPw] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);

  async function setDealerPassword() {
    const pw = portalPw.trim();
    if (pw.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    setPortalBusy(true);
    const promise = fetch(`/api/catalog/dealers/${id}/portal`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    })
      .then(async (r) => {
        const j = (await r.json()) as {
          ok?: boolean;
          login?: string;
          created?: boolean;
          error?: string;
        };
        if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo fijar la contraseña");
        setPortalPw("");
        qc.invalidateQueries({ queryKey: ["dealer", idStr] });
        return j;
      })
      .finally(() => setPortalBusy(false));

    toast.promise(promise, {
      loading: "Fijando contraseña…",
      success: (j) =>
        j.created
          ? `Acceso creado — login: ${j.login}`
          : `Contraseña fijada — login: ${j.login}`,
      error: (e) => (e instanceof Error ? e.message : "Falló"),
    });
  }

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
  if (!isNew && isError) {
    const status = (error as (Error & { status?: number }) | null)?.status;
    const notFound = status === 404;
    return (
      <ErrorState
        title={notFound ? "Dealer not found" : "Couldn't load this dealer"}
        message={
          notFound
            ? `Dealer #${idStr} doesn't exist or you don't have permission to see it.`
            : "Something went wrong loading the dealer. Check your connection and try again."
        }
        backHref="/catalog"
        onRetry={notFound ? undefined : () => refetch()}
      />
    );
  }
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
            {/* Price/SQF hidden — billing is a fixed price per door
                ($300 single / $600 double), not per-SQF. */}
            <Field label="Email" icon={<Mail size={12} />}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10"
              />
            </Field>
            <Field label="Phone" icon={<Phone size={12} />}>
              <PhoneField value={phone} onChange={setPhone} />
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

        {!isNew && data && (
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="mb-1 font-semibold text-slate-800">Acceso portal</h2>
            <p className="mb-4 text-xs text-slate-500">
              {data.portal?.has_user ? (
                <>
                  Acceso {data.portal.active ? "activo" : "inactivo"} · login:{" "}
                  <span className="font-mono">{data.portal.login}</span>
                </>
              ) : data.dealer.email ? (
                <>
                  Sin acceso — al fijar la clave se creará con login{" "}
                  <span className="font-mono">{data.dealer.email as string}</span>
                </>
              ) : (
                "Sin acceso — agregá un email y guardá antes de fijar la clave."
              )}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <KeyRound size={12} /> Nueva contraseña
                </span>
                <div className="relative">
                  <Input
                    type={showPortalPw ? "text" : "password"}
                    value={portalPw}
                    onChange={(e) => setPortalPw(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    disabled={!data.dealer.email}
                    className="h-10 w-64 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPortalPw((v) => !v)}
                    aria-label={showPortalPw ? "Ocultar" : "Ver"}
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    {showPortalPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              <Button
                type="button"
                onClick={setDealerPassword}
                disabled={portalBusy || !data.dealer.email || portalPw.trim().length < 6}
              >
                <KeyRound size={14} />
                {portalBusy ? "Guardando…" : "Fijar contraseña"}
              </Button>
            </div>
            {!data.dealer.email && (
              <p className="mt-2 text-xs text-amber-700">
                Agregá un email primero y guardá.
              </p>
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
