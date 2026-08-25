"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Claro / Oscuro / Sistema.
 *
 * Tres opciones y no un interruptor de dos, porque "Sistema" es lo que la
 * mayoria quiere sin saber que lo quiere: el taller abre la app de dia y
 * Majela la mira de noche desde el celular, y el telefono ya sabe cual toca.
 *
 * Se renderiza un hueco del mismo tamano hasta que el tema esta resuelto. El
 * tema real vive en localStorage y el servidor no puede saberlo, asi que
 * pintar el icono antes de tiempo produce un parpadeo y un error de
 * hidratacion. next-themes deja `theme` en undefined hasta que lo lee del
 * cliente, asi que ese chequeo alcanza -- no hace falta un useEffect que
 * setee un flag de montado.
 */

const OPCIONES = [
  { id: "light", label: "Claro", Icon: Sun },
  { id: "dark", label: "Oscuro", Icon: Moon },
  { id: "system", label: "Sistema", Icon: Monitor },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  if (theme === undefined) {
    return <div className={cn("h-8 w-[102px]", className)} aria-hidden />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tema de la interfaz"
      className={cn(
        "flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5",
        className,
      )}
    >
      {OPCIONES.map(({ id, label, Icon }) => {
        const activo = theme === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={activo}
            aria-label={label}
            title={label}
            onClick={() => setTheme(id)}
            className={cn(
              "flex h-7 w-8 items-center justify-center rounded-md transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600",
              activo
                ? "bg-indigo-50 text-indigo-700"
                : "text-slate-400 hover:bg-slate-50 hover:text-slate-600",
            )}
          >
            <Icon size={14} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
