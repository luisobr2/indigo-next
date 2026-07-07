# Diseño — Fijar contraseña del dealer desde el admin

**Fecha:** 2026-07-07
**Estado:** Aprobado (pendiente review del spec)
**Repos afectados:** `indigo-next` (UI + API) y `odoo-indigo` (módulo `indigo_decors`)

## Problema

En el admin Next.js, la ficha del dealer (`/catalog/dealers/[id]`) no tiene
ninguna opción para darle acceso ni fijarle la contraseña. Los dealers entran
como **usuarios portal de Odoo** (`res.users`, grupo `base.group_portal`,
`login = email`). Hoy la única forma de fijar su clave es:

1. Entrar al backend de Odoo.
2. Apretar "Crear usuario portal" (`action_indigo_create_portal_user` en
   `res.partner`), que crea el `res.users` y **manda un email** con link para
   que el dealer ponga su propia clave.

No existe forma de que un manager **teclee** la contraseña del dealer, como sí
puede hacerlo con los usuarios del staff (`indigo_team_reset_password`).

## Objetivo

Desde la ficha del dealer en el admin Next.js, que un manager/office pueda
**teclear y fijar** la contraseña del dealer. Si el dealer todavía no tiene
cuenta portal, se **crea en el mismo paso** (login = email), sin depender del
flujo de email.

## Decisiones tomadas (brainstorming)

- **Flujo:** teclear la clave directo (reutiliza el mecanismo del staff). El
  manager se la comunica al dealer por fuera (WhatsApp/teléfono).
- **Sin cuenta portal:** al fijar la clave, si no existe usuario portal se crea
  (login = email) y se le fija esa clave en un solo paso. Requiere email cargado.
- **Permisos:** manager **+ office** (consistente con quién edita dealers hoy en
  `PUT /api/catalog/dealers/[id]`), no manager-only.

## Diseño

### 1. Odoo — `res.partner` (en `models/indigo_dealer.py`)

Dos métodos `@api.model`, verificando caller manager/office y ejecutando el
trabajo privilegiado vía `sudo()` (mismo patrón que `indigo_team_*`).

Se agrega un helper de guardia análogo a `_indigo_assert_manager`, pero que
acepta manager **u** office:

```python
def _indigo_assert_dealer_admin(self):
    u = self.env.user
    if not (
        u._is_admin()
        or u.has_group("indigo_decors.group_indigo_manager")
        or u.has_group("indigo_decors.group_indigo_office")
    ):
        raise AccessError(_("Only Indigo managers or office can manage dealer access."))
```

**`indigo_dealer_portal_info(partner_id)`** → estado del acceso portal.
- `sudo` busca `res.users` con `partner_id = partner_id` (con `active_test=False`).
- Devuelve `{ "has_user": bool, "login": str|False, "active": bool }`.

**`indigo_dealer_set_password(partner_id, password)`** → crea-si-falta + fija clave.
1. `_indigo_assert_dealer_admin()`.
2. `password = (password or "").strip()`; si `len < 6` → `ValidationError`.
3. `partner = sudo().browse(partner_id)`; si no existe → error.
4. Si `not partner.email` → `ValidationError("El dealer necesita un email para el acceso portal.")`.
5. Buscar usuario existente:
   - `user = sudo().with_context(active_test=False).search([("partner_id","=",partner.id)], limit=1)`.
   - Si no hay por partner, chequear colisión por login:
     `clash = search([("login","=",partner.email)], limit=1)`. Si `clash` existe
     y su `partner_id != partner.id` → `ValidationError("Ya existe otro usuario con login <email>.")`.
6. Si no existe user: crear con
   `with_context(no_reset_password=True).create({name, login=email, partner_id, groups_id=[(6,0,[group_portal.id])]})`.
   `created = True`.
7. `user.write({"password": password, "active": True})`.
8. Devolver `{ "ok": True, "login": user.login, "created": created }`.

**Por qué un método nuevo y no `action_indigo_create_portal_user`:** ese
fuerza el email de reset y lanza error si el usuario ya existe — lo opuesto a
"teclear la clave directo".

### 2. Next.js — API

**`GET /api/catalog/dealers/[id]`** (extender): agregar al JSON un objeto
`portal` con el estado, para que la ficha lo muestre sin fetch aparte.
- Tras leer el partner, llamar `res.partner.indigo_dealer_portal_info(id)`.
- Respuesta: `{ dealer, orders, portal: { has_user, login, active } }`.

**`PUT /api/catalog/dealers/[id]/portal`** (route nueva): fijar la clave.
- Gate: `role.isManager || role.isOffice || isAdmin`, si no → 403.
- Body: `{ password: string }`. Validación mínima de presencia (la de longitud
  la hace Odoo y devuelve el mensaje).
- Llama `res.partner.indigo_dealer_set_password(id, password)`.
- Devuelve el resultado `{ ok, login, created }` de Odoo; en error, `{ error }`
  con status 400/500 (mismo manejo que las otras routes).

### 3. Next.js — UI (ficha del dealer, `src/app/(app)/catalog/dealers/[id]/page.tsx`)

Card nueva **"Acceso portal"**, visible solo en edición (no en `isNew`), debajo
de "Dealer info". Estado desde `data.portal`.

- **Header/estado:**
  - `has_user` → "Acceso activo · login: `{login}`" (o "inactivo" si `!active`).
  - `!has_user` → "Sin acceso — al fijar la clave se creará con login `{email}`".
- **Control:** input `type=password` con toggle ver/ocultar (patrón del
  login/users) + botón **"Fijar contraseña"**.
  - Sin email cargado en el form → input y botón deshabilitados + hint
    "Agregá un email primero y guardá".
  - `< 6` chars → botón deshabilitado.
- **Submit:** `PUT /api/catalog/dealers/[id]/portal`. Al éxito: limpiar el
  input, `toast.success` ("Contraseña fijada — login: `{login}`"; si `created`,
  "Acceso portal creado"), e invalidar `["dealer", idStr]` para refrescar el
  estado. Al error: `toast.error` con el mensaje.

## Casos borde

- **Dealer sin email:** UI deshabilita; Odoo también valida (defensa en profundidad).
- **Colisión de login (email ya usado por otro usuario):** Odoo devuelve error
  claro; la UI lo muestra en el toast.
- **Usuario portal archivado:** `set_password` lo reactiva (`active = True`).
- **`isNew`:** la card no se muestra (todavía no hay partner id). El manager
  crea el dealer, y al reabrirlo en edición aparece la card.

## Testing / verificación

No hay framework de tests en `indigo-next`. Verificación:
- **Odoo:** los métodos nuevos pueden cubrirse con un test en
  `addons/indigo_decors/tests/` (crear partner con email → `indigo_dealer_set_password`
  → assert user creado, portal group, login, password válido vía `authenticate`;
  segundo llamado → `created=False`; sin email → `ValidationError`).
- **Next.js:** `tsc --noEmit` + `eslint`, y drive manual contra el dev server
  (login como manager, fijar clave a un dealer, verificar que el dealer puede
  loguear con email + clave).

## Fuera de alcance (YAGNI)

- Enviar email de "fijar clave" (se descartó en favor de teclear directo).
- Botón para revocar/archivar el acceso portal del dealer (se puede agregar
  después si hace falta; hoy no lo piden).
- Gestión de contraseña del dealer desde el backend de Odoo (ya existe la vía
  estándar de Odoo ahí).
