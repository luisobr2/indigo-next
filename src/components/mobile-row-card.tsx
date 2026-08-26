"use client";

import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * Una fila de tabla, convertida en tarjeta para el telefono.
 *
 * ── Por que existe ──
 *
 * Se midio la app en un iPhone 13 real (390 px). Ninguna pantalla desborda
 * -- los contenedores con overflow-x-auto hacen su trabajo -- pero eso
 * esconde el problema en vez de resolverlo: la tabla de Paint mide 1200 px
 * dentro de una ventana de 364 px, asi que hay que **arrastrar tres pantallas
 * a la derecha** para llegar al SQF, al color y al importe, que es justo la
 * hoja del pintor. Y el boton "Received" vive al final de esa fila, midiendo
 * 24 px de alto cuando el minimo tactil son 44.
 *
 * Apilar en vertical lo que en horizontal no cabe es lo unico que arregla las
 * dos cosas a la vez: se lee todo sin arrastrar, y la accion puede ocupar el
 * ancho entero.
 *
 * ── Por que no se reemplaza la tabla ──
 *
 * En un ordenador la tabla es mejor: comparar veinte filas de un vistazo es
 * exactamente lo que una tabla hace bien y una lista de tarjetas hace mal. Asi
 * que conviven: tarjetas por debajo de `md`, tabla a partir de ahi. El mismo
 * criterio que ya usa la pantalla del instalador, que nacio para el movil.
 */

export interface CardField {
  label: string;
  value: ReactNode;
  /** Para el dato que se busca primero (importe, SQF). Se pinta mas grande. */
  strong?: boolean;
  /** Ocupa la fila entera en vez de media (direcciones, notas largas). */
  wide?: boolean;
}

export function MobileCardList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  // `md:hidden` y no una consulta en JS: renderizar segun el ancho medido en
  // el cliente provoca un parpadeo en la primera pintura y rompe el HTML del
  // servidor. CSS decide antes de que nada se vea.
  return <div className={cn("space-y-2 md:hidden", className)}>{children}</div>;
}

export function MobileRowCard({
  title,
  subtitle,
  badge,
  fields,
  action,
  selected,
  onSelect,
  selectLabel,
  onOpen,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  fields: CardField[];
  /** Se pinta a lo ancho, con altura de dedo. */
  action?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  selectLabel?: string;
  /** Si se pasa, la cabecera entera abre el detalle. */
  onOpen?: () => void;
}) {
  const visible = fields.filter((f) => f.value !== null && f.value !== undefined && f.value !== "");

  return (
    <article
      className={cn(
        "rounded-2xl border bg-white p-3 shadow-sm transition",
        selected ? "border-indigo-300 bg-indigo-50/40" : "border-slate-200",
      )}
    >
      <div className="flex items-start gap-3">
        {onSelect && (
          // Envuelto en un <label> con altura de dedo: la casilla en si mide
          // 16 px y ni con su area extendida llega a 44. Aqui el objetivo es
          // toda la columna izquierda de la tarjeta.
          <label
            className="-m-1 flex min-h-11 min-w-11 cursor-pointer items-center justify-center p-1"
            aria-label={selectLabel}
          >
            <Checkbox checked={!!selected} onCheckedChange={onSelect} aria-label={selectLabel} />
          </label>
        )}

        <div className="min-w-0 flex-1">
          <div
            className={cn("min-w-0", onOpen && "cursor-pointer")}
            onClick={onOpen}
            role={onOpen ? "button" : undefined}
            tabIndex={onOpen ? 0 : undefined}
            onKeyDown={
              onOpen
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen();
                    }
                  }
                : undefined
            }
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 text-[15px] font-semibold leading-tight text-slate-900">
                {title}
              </div>
              {badge}
            </div>
            {subtitle && (
              <div className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</div>
            )}
          </div>

          {visible.length > 0 && (
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
              {visible.map((f) => (
                <div key={f.label} className={cn("min-w-0", f.wide && "col-span-2")}>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    {f.label}
                  </dt>
                  {/* 14 px minimo: el 10-11 px que usan las tablas se lee bien
                      a 60 cm de un monitor y no a un brazo de distancia con el
                      telefono en la mano. */}
                  <dd
                    className={cn(
                      "mt-0.5 text-sm text-slate-800",
                      f.strong && "text-base font-bold",
                    )}
                  >
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {action && <div className="mt-3 [&>*]:w-full [&_button]:h-11 [&_button]:w-full">{action}</div>}
    </article>
  );
}
