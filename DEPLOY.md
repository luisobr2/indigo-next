# DEPLOY.md — Cómo se despliega el panel

El panel (este repo) y Odoo (`luisobr2/odoo-indigo`) viven en el mismo VPS con
**Coolify**. Cada uno es un recurso aparte. Credenciales (token de Coolify, SSH)
**nunca** en este repo: están en la configuración privada de quien despliega.

| | Panel (este repo) | Odoo |
|---|---|---|
| Repo | `luisobr2/indigo-next` | `luisobr2/odoo-indigo` |
| URL | https://app.indigodecors.com | https://indigodecors.com |
| Recurso Coolify | `qjalaa0kakcwbjkb1t3j2tqg` | `f57xxcgj6dph9nkrvekz91h6` |
| Imagen | `Dockerfile` (Next standalone) | `Dockerfile` del repo de Odoo |

## Antes de desplegar

1. `npm test` y `npx tsc --noEmit -p .` en verde.
2. Si es un cambio visual: visto en local y aprobado (ver `DESIGN.md`).
3. **Permiso explícito** para desplegar: cada despliegue se pide.

## Orden cuando el cambio toca los dos lados

Si una pantalla nueva llama a un método nuevo de Odoo, **primero Odoo**:

1. Copia de la base: `pg_dump -Fc indigo-prod` dentro del contenedor de la base
   (queda en `/root/backups/` del VPS).
2. Push de `odoo-indigo` → deploy de su recurso en Coolify.
3. Actualizar el módulo y reiniciar (solo si cambian modelos, vistas, datos o la
   versión del manifiesto; las migraciones corren aquí):
   `odoo -c /etc/odoo/odoo.conf -d indigo-prod -u indigo_decors --stop-after-init --no-http`
   y después `docker restart` del contenedor de Odoo.
4. Push de este repo → deploy del panel en Coolify.
5. Comprobar: la tienda y `app.indigodecors.com/login` responden 200, y probar la
   pantalla cambiada.

Solo panel: pasos 4 y 5.

## Desplegar el panel

```
git push origin main
POST http://<VPS>:8000/api/v1/deploy?uuid=qjalaa0kakcwbjkb1t3j2tqg&force=true
     Authorization: Bearer <token de Coolify>
```

Coolify compila la imagen (5–7 min) y cambia el contenedor sin cortar.

## Variables de entorno (Coolify → recurso del panel)

Ver `.env.example`. Las que importan: `ODOO_URL`, `ODOO_DB` (`indigo-prod`),
`SESSION_SECRET` (≥32 caracteres; cambiarla cierra la sesión de todos),
`COOKIE_SECURE`, `PUBLIC_PANEL_URL`, `PUBLIC_SITE_URL`, `MCP_ENABLED`.

⚠️ `ODOO_DB` y el `dbfilter` de Odoo van juntos: si se restaura la base con otro
nombre, hay que cambiar los dos a la vez o se caen la tienda y el panel.

## Si algo sale mal

- Panel roto: en Coolify, redesplegar el commit anterior (o `git revert` + push +
  deploy).
- Odoo roto tras `-u`: los logs del contenedor dicen qué módulo falló; restaurar
  la copia del paso 1 **con el nombre exacto `indigo-prod`**.

## Desarrollo local (no es despliegue, pero se confunde)

- `.env.local` apunta a **producción**. Para probar contra el Odoo local:
  `ODOO_URL=http://localhost:8069 npx next dev --webpack -p 5173`.
- Siempre con `--webpack` (`npm run dev` ya lo lleva): Turbopack abre decenas de
  procesos node en un PC de muchos núcleos.
