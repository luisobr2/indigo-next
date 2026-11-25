# DESIGN.md — Panel de Indigo Decors

Cómo se ve el panel (app.indigodecors.com) **hoy** y las reglas para tocarlo.
No es una propuesta: es la descripción del sistema que el equipo ya usa a
diario. Cualquier pantalla nueva tiene que parecer hecha por la misma mano.

## Regla número uno: pulir no es rediseñar

El 11-nov-2026 se rediseñó el dashboard y el login (se quitó el saludo, el
funnel, el donut y los iconos de colores) y el cliente pidió deshacerlo todo.
Lo que funciona y el equipo conoce **se queda como está**:

- Mejorar el aspecto sí: espaciado, contraste, alineación, modo oscuro, textos
  cortados.
- Quitar, sustituir o reordenar secciones, gráficos, textos o colores que ya
  están: **no**, salvo que lo pidan.
- Todo cambio visual se enseña primero en local (captura de antes y después) y
  se sube solo con el visto bueno.

## Marca y color

- **Azul Indigo `#1f4486`** (`indigo-700`): acciones principales, enlaces,
  selección, la barra activa del menú. Es el único color de marca.
- **Neutros: la escala `slate` de Tailwind.** Fondo de la app `#f4f6fb`, texto
  `#1a2740`, tarjetas `bg-white`, bordes `border-slate-100/200`, texto
  secundario `text-slate-500`.
- **Colores de estado** (solo con significado): verde `emerald` = bien / hecho
  / cobrado; ámbar `amber` = atención; rojo `rose` = atrasado, error,
  incidencia; cielo `sky` = informativo. Los badges usan el tinte `-50` de
  fondo y el `-700` de texto (`bg-emerald-50 text-emerald-700`).
- La escala `indigo` está redefinida en `src/app/globals.css` (`@theme`) para
  que `indigo-700` sea exactamente el azul de la marca.

## Modo oscuro

No hay clases `dark:` en las pantallas. `globals.css` **redefine las variables
de color** bajo `.dark` (`--color-white`, toda la escala `slate`, `indigo` y los
tintes de estado), así que cualquier utilidad normal cambia sola.

- Si usas un color de estado nuevo (un paso de `orange`, `sky`, `violet`… que no
  esté en el bloque `.dark`), **añádelo allí** o saldrá como una mancha clara
  sobre fondo oscuro (pasó en Installations, Anota #8).
- En gráficos (recharts) no pongas hex fijos si deben seguir el tema: usa
  `var(--color-slate-300)` y similares, que sí cambian con `.dark`.
- `bg-white` en oscuro es el azul de las tarjetas (`#131c30`), no blanco: para un
  blanco literal (la placa del logo) usa un hex.

## Tipografía

- **Inter** (con la pila del sistema detrás), definida en `--font-sans`.
- Títulos de página: `text-2xl font-bold tracking-tight text-slate-900
  sm:text-3xl`, con una línea de subtítulo `text-sm text-slate-500` debajo.
- Títulos de tarjeta: `font-semibold text-slate-800`.
- Cifras: `tabular-nums` siempre que se alineen en columnas.
- La interfaz está **en inglés**; el equipo escribe en español. Los textos que
  ve el dealer, también en inglés.

## Composición

- Página: `mx-auto max-w-[1500px] space-y-5` (o `space-y-6`).
- Cabecera de página: título y subtítulo a la izquierda, botones a la derecha
  (`flex flex-wrap items-end justify-between gap-3`).
- **Tarjeta**: `rounded-2xl border border-slate-100 bg-white shadow-sm`, con
  `p-5` o tabla dentro.
- **Pestañas de filtro** (Users, Activity log): fila de botones con borde
  inferior; la activa `border-indigo-700 text-indigo-700`.
- **Tablas**: cabecera `text-xs font-semibold uppercase text-slate-500`, filas
  separadas por `divide-y divide-slate-100`, `overflow-x-auto` en el contenedor
  para el móvil.
- **Tarjeta de cifra**: `src/components/kpi-card.tsx` (icono en un cuadro de
  color, etiqueta, número grande). Es la misma en Dashboard, Billing, Reports,
  Installations, Installers y Catalog: no hagas otra.
- Estados vacíos y de error: `EmptyState` / `ErrorState` de
  `src/components/state-cards.tsx`.

## Componentes

- Base: `src/components/ui/` (shadcn sobre `@base-ui/react`): `Button`, `Input`,
  `Badge`, `Dialog`, `Select`, `Tabs`, `Tooltip`…
- Iconos: **lucide-react**, 14–18 px.
- Avisos: `sonner` (`toast`, `toast.promise` para acciones que tardan).
- Desplegables de filtro sencillos: `<select>` nativo con
  `h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm`.

## Móvil

El equipo de taller usa el teléfono. Toda pantalla nueva se comprueba a 390 px:
las filas se apilan, las tablas anchas se desplazan dentro de su contenedor y
ningún botón se parte en dos líneas (`whitespace-nowrap`).

## Antes de dar por terminado un cambio visual

1. Captura en local, en claro **y** en oscuro, escritorio y móvil.
2. Que no haya cambiado nada que no se pidió.
3. Enseñarlo y esperar el visto bueno antes de subirlo.
