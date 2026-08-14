# Diseño — Control del sistema Indigo por AI (servidor MCP)

**Fecha:** 2026-08-14
**Estado:** Aprobado en chat (pendiente review del spec)
**Repos afectados:** `indigo-next` (MCP + auth + API) y `odoo-indigo` (API keys, sin cambios de modelo previstos)

## Problema

Majela y Javier operan el taller a través del panel: 68 rutas API, 90 handlers.
Todo el trabajo pasa por pantallas. Buena parte de lo que hacen en el día es
consulta repetitiva ("¿qué hay para pintar hoy?", "¿en qué está la orden de
Pérez?") o transcripción manual (una orden que llegó por WhatsApp o en papel).

No existe hoy ninguna superficie para máquinas: ni tokens, ni OpenAPI, ni MCP.
La única forma de autenticarse es una cookie de browser.

## Objetivo

Que el equipo de Indigo pueda operar el sistema hablándole a un asistente
(Claude Cowork, Codex u otro), en vez de navegar el panel — con el alcance
completo del negocio, y con el humano siempre en el loop.

## Decisiones tomadas

| Pregunta | Respuesta |
|---|---|
| ¿Quién lo maneja? | El equipo de Indigo (Majela, Javier). Gente **no técnica**, humano en el loop. **No** dealers externos. |
| ¿Qué alcance? | **Todo**: consultar, operar el flujo, crear y editar órdenes, dinero y administración. |
| ¿Qué superficie? | **Servidor MCP** — Cowork, Codex y Claude Code lo hablan; se escribe una vez y sirve para todos. |
| ¿Qué envuelve? | **La API del panel** (enfoque A), no Odoo directo. |

### Por qué NO hablarle a Odoo directo

Es el enfoque tentador porque es poco código y las ACL de Odoo aplican solas.
Se descartó porque saltea la capa donde viven los invariantes. Ejemplo concreto,
de `src/app/api/orders/[id]/advance/route.ts`: hay un `ALLOWED_WIZARDS` cuyo
comentario dice que sin él `body.wizard` permitiría "`create` a record on any
model", más un `SENSITIVE_WIZARDS` que restringe el wizard de dinero. Esas son
fronteras de seguridad que existen **en el panel, no en Odoo**. Un agente
escribiendo campos crudos rompe invariantes que ningún ACL protege: avanzar una
etapa sin correr su wizard, tocar un payout sin recalcular SQF.

## Estado actual relevado (2026-08-14)

Datos medidos, no estimados:

- **Superficie API**: 68 archivos `route.ts`, 90 handlers — 40 GET, 32 POST,
  8 PUT, 7 DELETE, 3 PATCH.
- **Auth**: cookie `indigo_session`, httpOnly, sameSite lax, 8 h. Contiene
  `{session, user:{id, login, name, partnerId, isAdmin, groups}}` en **JSON
  plano, sin firmar ni cifrar**. `getSession()` hace `JSON.parse` de lo que
  venga. Los gates de rol del panel (`deriveRole(s.user.groups)`) leen de ahí;
  el backstop real son las ACL de Odoo.
- **Audit**: `indigo.order` hereda `mail.thread` + `mail.activity.mixin`.
- **Odoo**: versión `base` 17.0.1.3. **`res.users.apikeys` disponible**, con
  `_generate`; 0 keys creadas hoy (verificado por `odoo shell` en producción).
- **Métodos Odoo pensados para el panel**: `indigo_team_*`, `indigo_dealer_*`,
  `indigo_get/set_capacities`, `indigo_family_types`, `rename_family`.
- **Datos en prod**: 161 diseños, ~142 productos de tienda.
- **Sin staging**: `.env.local` apunta a `http://2.25.137.220:8069` (producción).
- **Tests**: `npm test` (runner nativo de Node) existe desde 2026-08-13; cubre
  lógica pura, no rutas.

## Arquitectura

El MCP vive **dentro de `indigo-next`, como ruta `/api/mcp`**. No es un servicio
nuevo.

- Cowork corre en la nube → el transporte debe ser **MCP remoto sobre HTTP**.
- Al vivir en el mismo proceso reusa `call()`, `deriveRole` y las reglas ya
  desplegadas, en vez de hablarse a sí mismo por la red.
- Un deploy menos y una superficie de token menos.

**Consecuencia de trabajo:** hoy la lógica vive *dentro* de los handlers. Para
que un tool MCP y una ruta HTTP compartan una sola implementación hay que
extraer los handlers a funciones de servicio (`src/lib/services/*`). Se hace
**incremental**: sólo lo que el MCP exponga, empezando por lo más usado. No es
un refactor de las 68 rutas de una.

## Auth

Tres piezas, en este orden:

1. **Firmar la cookie de sesión** con **HMAC sobre el payload actual**. Se
   elige HMAC y no JWT/iron-session: conserva la forma del payload, no agrega
   dependencia y es el cambio mínimo que cierra el agujero. Precondición de
   todo lo demás — no se emiten credenciales de máquina apoyadas en una base
   falsificable.
2. **Identidad por persona con API key de Odoo.** Cada operador tiene la suya.
   El RPC autentica como esa persona ⇒ ACL, record rules y el `mail.thread` de
   las órdenes **atribuyen solos**, sin escribir código de audit. Sin cuenta de
   servicio compartida y sin guardar contraseñas.
3. **Token MCP** propio, guardado en un modelo Odoo nuevo `indigo.mcp.token`
   del módulo `indigo_decors`, que mapea a `{uid, api_key, scope, active}`.
   Vive en Odoo y no en el panel para que entre en el mismo backup que el resto
   y se pueda revocar desde el backend.

   *Se evaluó usar la API key de Odoo directamente como token MCP, lo que
   ahorraría el modelo entero. Se descartó porque entonces el alcance del
   agente queda pegado a los permisos Odoo de la persona, y se pierde poder
   darle a Javier un token de sólo lectura sin recortarle el panel.*

**Propiedad clave:** si Majela le pide algo al agente, en la orden queda
registrado como Majela, no como "el bot". Eso es lo que hace auditable un
sistema manejado por AI.

## Vocabulario de tools

**No mapear 1:1.** Noventa handlers no son noventa tools: un agente con noventa
tools elige mal y compone llamadas de bajo nivel para tareas que el negocio
piensa como una sola. El vocabulario se diseña sobre lo que hace la gente.
Objetivo: **15–25 tools** en seis grupos (los de abajo suman 23).

| Grupo | Tools (indicativo) |
|---|---|
| Lectura y búsqueda | `find_orders`, `get_order`, `today_board`, `catalog_search`, `dealer_info` |
| Descubrimiento | `list_stages`, `list_dealers`, `list_designs`, `list_people` |
| Flujo | `advance_order`, `assign_order`, `schedule_install`, `hold_order`, `add_note` |
| Alta y edición | `create_order`, `update_order`, `manage_order_lines` |
| Dinero | `billing_summary`, `settle_payout`, `register_payment` |
| Administración | `manage_design`, `manage_dealer`, `manage_user` |

**Los tools de descubrimiento no son opcionales.** Sin ellos el modelo inventa
un código `ID99` que no existe. Con ellos, se ancla en los 161 diseños reales.

**`advance_order` es el caso testigo.** Hoy la ruta exige `wizard:
"indigo.painter.done.wizard"` + payload. Un agente no tiene por qué conocer
nombres de modelos Odoo, y si se los hacés adivinar los inventa. El tool recibe
*"la pintura de la orden 412 está lista, 20 SQF"* y elige el wizard él. Es el
vocabulario de dominio aplicado donde de verdad hace falta.

## Guardrails

Con alcance "todo" y operador no técnico, acá va el peso del proyecto.

1. **Tres niveles por tool.** *Lectura* (sin fricción) · *escritura reversible*
   (actúa y registra) · *peligrosa* (dinero, borrados, masivos → preview +
   confirmación). Para el nivel peligroso se reusa la clasificación existente:
   `SENSITIVE_WIZARDS` ya marca el wizard de dinero.
2. **Preview obligatorio en lo destructivo.** La operación devuelve primero qué
   va a cambiar (`dry_run` por defecto) y sólo ejecuta contra un token de
   confirmación de esa preview. Doble beneficio: le da al agente algo concreto
   que mostrarle a Majela en castellano antes de romper nada.
3. **Tope de blast radius.** Ningún tool toca más de N registros por llamada
   (arrancar en 25). Existen `orders/bulk` y `designs/publish-bulk`: sin tope,
   un agente confundido despublica los ~142 productos de la tienda.
4. **Idempotencia en altas y pagos.** Hoy `POST /api/orders` no la tiene: un
   reintento por timeout crea dos órdenes, y crear una orden **dispara mail
   inmediato a los managers** (buzón de Majela incluido). Dos órdenes fantasma
   son dos correos.
5. **Marca de origen.** Toda escritura vía MCP deja nota en el timeline
   indicando que vino del asistente, además de quedar a nombre de la persona.
6. **Rate limit por token.**
7. **Kill switch**: flag que apaga el MCP sin desplegar.

### Nunca se exponen como tool

- **`auth/impersonate`** — un agente que puede suplantar usuarios no tiene
  frontera de permisos en absoluto.
- **Reseteo de contraseñas** (`indigo_team_reset_password`,
  `indigo_dealer_set_password`).
- **Borrado de usuarios.**

Esto vale aunque el alcance acordado incluya administración.

## Errores

Los mensajes de error son **superficie de UX, no líneas de log**: el agente los
lee para decidir qué hacer y después se los relata a Majela.

Cada fallo devuelve un código estable + mensaje accionable en castellano, y
distingue cuatro casos que llevan a acciones distintas:

| Caso | Qué debe hacer el agente |
|---|---|
| Input inválido | Corregir y reintentar |
| Permiso denegado | Frenar y avisar al humano |
| Conflicto | Preguntar al humano |
| Transitorio | Reintentar |

Nada de stack traces ni internals de Odoo — el agente se los pasa tal cual al
operador. El registro correcto ya existe en el código: el rename devuelve *"Ya
hay un diseño usando ID61 (ID61-SD)"* y aclara si quien lo ocupa está archivado.

## Testing

- **Unitarios**: esquemas de tools y mapeo puro, con el `npm test` existente.
- **Contrato**: cada tool contra un Odoo real. Nota de calibración: en el
  trabajo del rename, 12 tests unitarios pasaban y el bug de fusión de familias
  no lo encontró ninguno — lo encontró razonar el caso, y lo confirmó el smoke
  contra Odoo.
- **Evals**: ~20 escenarios guionados ("creá una orden para Lock Tight, puerta
  doble negra 36x80") que verifican que el agente elige los tools correctos y
  deja el registro bien. Sin esto no se puede saber si un cambio de prompt o de
  tool mejoró o empeoró; sólo quedan anécdotas.

**Staging es precondición, no un lujo.** Hoy `.env.local` apunta a producción.
Es tolerable mientras lo maneja un humano con cuidado; con un agente que
escribe, no lo es. Es el único lugar donde la AI puede equivocarse.

## Inventario por fase

> **Alcance de este spec.** Cubre las cinco fases para que se vea el destino
> completo, pero **es demasiado para un solo plan de implementación**. Cada
> fase se planifica y se ejecuta por separado. El próximo paso es un plan que
> cubra **fase 0 + fase 1** únicamente; las fases 2–4 se replanifican con lo
> aprendido del uso real de la fase 1, que es justamente para lo que sirve
> empezar por sólo lectura.

### Fase 0 — Precondiciones

- [ ] Firmar la cookie de sesión (HMAC o JWT); invalidar las existentes al desplegar
- [ ] Auditar qué rutas confían en `groups`/`isAdmin` del cookie sin backstop de ACL en Odoo
- [ ] Levantar **staging**: Odoo + Postgres + panel, con datos anonimizados o semilla
- [ ] `.env.local` deja de apuntar a producción; documentar cómo apuntar a staging
- [ ] Kill switch del MCP (variable de entorno leída en cada request)

### Fase 1 — MCP de sólo lectura

- [ ] Ruta `/api/mcp` con transporte HTTP remoto
- [ ] Modelo `indigo.mcp.token` en `indigo_decors` → `{uid, api_key, scope, active}` + ACL manager
- [ ] Generación de API keys de Odoo por persona (`res.users.apikeys._generate`)
- [ ] Autenticación del RPC con API key en vez de sesión de browser
- [ ] Extraer a `src/lib/services/` los handlers de lectura que el MCP exponga
- [ ] Tools de lectura: `find_orders`, `get_order`, `today_board`, `catalog_search`, `dealer_info`
- [ ] Tools de descubrimiento: `list_stages`, `list_dealers`, `list_designs`, `list_people`
- [ ] Formato de error estable con los 4 casos
- [ ] Log de toda llamada a tool: quién, cuál, args, resultado, duración
- [ ] Rate limit por token
- [ ] Documento de conexión para Majela y Javier (cómo enchufarlo en Cowork)
- [ ] Evals de lectura (~8 escenarios)

### Fase 2 — Escritura reversible

- [ ] Framework de niveles (lectura / reversible / peligrosa) aplicado por tool
- [ ] Marca de origen en el timeline de la orden
- [ ] Tope de blast radius configurable
- [ ] `advance_order` con selección de wizard del lado servidor
- [ ] `assign_order`, `schedule_install`, `hold_order`, `add_note`
- [ ] Evals de flujo (~6 escenarios)

### Fase 3 — Alta de órdenes

- [ ] Claves de idempotencia en `POST /api/orders` y en el tool
- [ ] `create_order` con líneas (piezas, medidas, color, dealer)
- [ ] `update_order`, `manage_order_lines`
- [ ] Verificar que el alta vía MCP respeta `indigo_skip_new_order_notify` donde corresponda
- [ ] Evals de alta (~6 escenarios), incluida la transcripción desde texto de WhatsApp

### Fase 4 — Dinero y administración

- [ ] Mecanismo de preview + token de confirmación
- [ ] `billing_summary`, `settle_payout`, `register_payment` (todas con preview)
- [ ] `manage_design`, `manage_dealer`, `manage_user` (sin reset de contraseñas)
- [ ] Evals de dinero (~4 escenarios), con foco en que el agente **no** ejecute sin confirmar

## Fuera de alcance

- Dealers externos hablándole al asistente (superficie pública; otro modelo de amenaza)
- Agente desatendido corriendo sin humano en el loop
- Chat embebido en el panel (posible fase 5; la API y el MCP lo habilitan)
- API HTTP pública con OpenAPI para terceros

## Riesgos y preguntas abiertas

1. **Costo de LLM**: lo paga quien opere el agente (Cowork/Codex de cada
   persona), no el proyecto. Cambiaría si más adelante se hace el chat embebido.
2. **Extracción a servicios**: es el trabajo menos visible y el que más se
   subestima. Mitigación: sólo se extrae lo que el MCP expone, por fase.
3. **`rename_family` fue el primer método pensado para llamadores no humanos.**
   Su patrón (validar todo antes de escribir, una transacción, error accionable)
   es el molde para los tools de escritura.
4. **Abierto:** ¿qué pasa cuando el agente se equivoca de forma reversible pero
   nadie lo nota hasta días después? El log de tools ayuda a reconstruir, pero
   no hay "deshacer" a nivel negocio. Evaluar en fase 2.
5. **Abierto:** ¿Cowork soporta hoy el transporte MCP remoto con auth por token
   de la forma que asume este diseño? Verificar antes de empezar la fase 1.
