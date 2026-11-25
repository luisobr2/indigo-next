# Indigo Decors — panel de operación

El panel con el que trabaja el taller Indigo Decors (Miami): órdenes de los
dealers, producción por etapas (diseño, CNC, pintura, instalación), rutas,
facturación, pagos al equipo, catálogo y el registro de actividad.
En producción: https://app.indigodecors.com

Es una interfaz sobre **Odoo 17** (repo `luisobr2/odoo-indigo`): toda la lógica y
los datos viven en Odoo; el panel habla con él por JSON-RPC con la sesión de
cada persona, así que los permisos son los de Odoo.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · shadcn/ui · TanStack
Query · recharts · servidor MCP propio para el asistente IA.

## Arrancar en local

```bash
npm install
# contra el Odoo LOCAL (docker compose del repo odoo-indigo):
ODOO_URL=http://localhost:8069 npx next dev --webpack -p 5173
```

`.env.local` apunta a producción: sin `ODOO_URL` local estarías trabajando sobre
datos reales. `npm run dev` arranca en el puerto 4000 con webpack.

## Pruebas

```bash
npm test              # node --test, lógica pura (src/**/*.test.ts)
npx tsc --noEmit -p . # tipos
```

## Documentación

- `CLAUDE.md` — cómo trabajar en este repo (también para agentes).
- `DESIGN.md` — el sistema visual y la regla de no rediseñar.
- `DEPLOY.md` — cómo se despliega, junto con Odoo.
- Contexto del negocio y de Odoo: `CLAUDE.md` del repo `odoo-indigo`.

Este repositorio es **público**: nada de contraseñas, tokens ni datos de
clientes en el código, los commits o las pruebas.
