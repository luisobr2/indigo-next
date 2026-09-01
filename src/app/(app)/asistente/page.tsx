"use client";

/**
 * Conectar el asistente de IA al sistema.
 *
 * ── Por que es una pantalla y no un documento ──
 *
 * Ya existe un instructivo en el repositorio y no lo ha abierto nadie: un
 * documento no puede responder la unica pregunta que la gente hace de verdad,
 * que es "¿yo estoy conectado?". Esta pantalla si, porque lee las claves de
 * la cuenta de quien la mira.
 *
 * Por eso el orden es: primero TUS conexiones, despues la URL con un boton de
 * copiar, y al final los pasos. Un instructivo pone los pasos arriba; una
 * herramienta pone el estado arriba.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Plug, Trash2, Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/fetch-json";
import { fmtDate } from "@/lib/utils";

const MCP_URL = "https://app.indigodecors.com/api/mcp";

interface Connection {
  id: number;
  client: string;
  createdAt: string;
}

/** Lo que se le puede pedir, en las palabras de quien lo va a pedir.
 *  Deliberadamente NO es la lista de las trece herramientas: nadie escribe
 *  "ejecuta today_board", escriben "que hay para pintar hoy". */
const EJEMPLOS = [
  "¿Qué hay para pintar hoy?",
  "¿En qué está la orden de Pérez?",
  "Muéstrame las órdenes de Lock Tight de esta semana",
  "¿Cuántas puertas quedan por instalar?",
  "Agenda la instalación de la 254 para el jueves",
  "Deja una nota en la orden 312: el cliente pidió cambiar el color",
];

const PASOS = [
  {
    app: "Claude (escritorio o web)",
    pasos: [
      "Abre Ajustes → Conectores.",
      "Pulsa «Agregar conector personalizado».",
      "Pega la dirección de arriba y confirma.",
    ],
  },
  {
    app: "Codex",
    pasos: [
      "Abre los ajustes de servidores MCP.",
      "Agrega uno nuevo de tipo HTTP.",
      "Pega la dirección de arriba.",
    ],
  },
];

export default function AsistentePage() {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<number | null>(null);

  const q = useQuery<{ enabled: boolean; connections: Connection[] }>({
    queryKey: ["mcp-connections"],
    queryFn: () => fetchJson("/api/mcp/connections"),
  });

  async function copiar() {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles (o http sin TLS): seleccionar a mano
      // sigue funcionando, asi que no se convierte en un error.
      toast.info("Copia la dirección a mano: el navegador no dio permiso.");
    }
  }

  async function desconectar(c: Connection) {
    if (!confirm(`¿Desconectar ${c.client}? Esa aplicación dejará de tener acceso.`)) return;
    setRevoking(c.id);
    try {
      const r = await fetch(`/api/mcp/connections/${c.id}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo desconectar");
      toast.success(`${c.client} quedó desconectado`);
      qc.invalidateQueries({ queryKey: ["mcp-connections"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo desconectar");
    } finally {
      setRevoking(null);
    }
  }

  const conexiones = q.data?.connections ?? [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          El asistente
        </h1>
        <p className="max-w-prose text-slate-600">
          Conecta Claude o Codex a Indigo y pregúntale por las órdenes con tus
          propias palabras. Ve exactamente lo mismo que ves tú aquí — ni más, ni
          menos — y todo lo que haga queda registrado a tu nombre.
        </p>
      </header>

      {/* Apagado: no tiene sentido explicar como conectarse a algo que no
          responde, asi que se dice y se corta. */}
      {q.data && !q.data.enabled && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 flex-none text-amber-600" />
          <div>
            <p className="font-semibold">El asistente está apagado ahora mismo.</p>
            <p className="mt-1">
              Nadie puede conectarse hasta que se vuelva a encender. Avisa a la
              oficina si lo necesitas.
            </p>
          </div>
        </div>
      )}

      {/* 1. TUS conexiones. Va primero porque es la pregunta real. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Plug size={17} className="text-indigo-700" />
          Tus conexiones
        </h2>

        {q.isLoading && (
          <div className="mt-4 h-16 animate-pulse rounded-xl bg-slate-100" />
        )}

        {!q.isLoading && conexiones.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">
            Todavía no tienes ninguna aplicación conectada. Sigue los pasos de
            abajo y esta lista se llenará sola.
          </p>
        )}

        {conexiones.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {conexiones.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900">{c.client}</div>
                  <div className="text-xs text-slate-500">
                    Conectado el {fmtDate(c.createdAt)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => desconectar(c)}
                  disabled={revoking === c.id}
                  className="h-11 w-full text-rose-700 hover:border-rose-300 hover:bg-rose-50 sm:h-8 sm:w-auto"
                >
                  <Trash2 size={13} />
                  {revoking === c.id ? "Desconectando…" : "Desconectar"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs text-slate-500">
          Si pierdes un teléfono o dejas de usar una aplicación, desconéctala
          aquí. El acceso se corta al instante.
        </p>
      </section>

      {/* 2. La direccion. Es el 90% de lo que la gente viene a buscar. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          La dirección para conectar
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Es lo único que hay que pegar. No hace falta ninguna clave: te va a
          pedir tu correo y tu contraseña de siempre.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-slate-50 px-3 py-3 font-mono text-sm text-slate-800 ring-1 ring-slate-200">
            {MCP_URL}
          </code>
          <Button
            onClick={copiar}
            className="h-11 w-full shrink-0 sm:w-auto"
            aria-live="polite"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copiada" : "Copiar"}
          </Button>
        </div>
      </section>

      {/* 3. Los pasos. Al final, y cortos. */}
      <section className="grid gap-4 sm:grid-cols-2">
        {PASOS.map((p) => (
          <div
            key={p.app}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h3 className="text-sm font-semibold text-slate-900">{p.app}</h3>
            <ol className="mt-2 flex flex-col gap-1.5 text-sm text-slate-600">
              {p.pasos.map((paso, i) => (
                <li key={paso} className="flex gap-2">
                  <span className="font-mono text-xs font-semibold text-indigo-700">
                    {i + 1}
                  </span>
                  {paso}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      {/* 4. Que pedirle. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Sparkles size={17} className="text-indigo-700" />
          Qué le puedes pedir
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Háblale normal. No hace falta aprenderse ningún comando.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {EJEMPLOS.map((e) => (
            <li
              key={e}
              className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-100"
            >
              «{e}»
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Antes de cambiar algo —mover una etapa, agendar, dejar una nota— te
          muestra qué va a hacer y espera tu confirmación.
        </p>
      </section>
    </div>
  );
}
