# Conectar el asistente al sistema Indigo (MCP)

**Para:** Majela, Javier — y quien más del equipo lo necesite.
**Qué es:** un puente que deja que un asistente de IA (Claude, Codex) trabaje
contra el sistema: consultar órdenes, el tablero, los dealers, y también mover
etapas, asignar, agendar y dejar notas.

> **Actualizado 2026-08-25.** La primera versión de este documento decía "solo
> lectura, seis herramientas". Quedó vieja: hoy son **trece**, y cinco de ellas
> escriben. Si alguien todavía cree que el asistente no puede tocar nada, es
> porque leyó la versión anterior.

---

## Los datos de conexión

| | |
|---|---|
| **URL** | `https://app.indigodecors.com/api/mcp` |
| **Tipo** | Servidor MCP remoto (HTTP) |
| **Autenticación** | Bearer token |
| **Token** | El tuyo, personal |

El token tiene la forma `tuemail@indigodecors.com.<clave larga>`. Va **entero**,
tal cual, incluido el email. **No lo cortes por el punto** — es el error más
común y el síntoma es un `401 Token invalido` que parece otra cosa.

Se saca de Odoo, desde tu propia cuenta: avatar arriba a la derecha →
*Mi perfil* → pestaña *Seguridad de la cuenta* → **Nueva clave API**. Te pide tu
contraseña. La clave se muestra **una sola vez**.

---

## La forma fácil: un comando

Desde la carpeta del panel (`indigo-next`):

```bash
node scripts/setup-mcp-client.mjs all --token "tuemail@indigodecors.com.<clave>"
```

Configura Claude Desktop, Codex y Claude Code de una, y **verifica contra
producción** antes de darse por terminado — si te dice OK, funciona de verdad;
no es que escribió un archivo y cruzó los dedos. Podés pasar `desktop`, `codex`
o `claude-code` en vez de `all` para hacer uno solo.

Tras configurar Claude Desktop hay que **cerrarlo del todo** (no solo la
ventana: también el icono de la bandeja) y volver a abrirlo.

---

## Qué necesita cada cliente, y por qué no son iguales

| Cliente | Cómo habla con el servidor |
|---|---|
| **Claude Code** | HTTP directo. Acepta el header, no necesita nada más. |
| **Codex** | HTTP directo. El token lo lee de la variable `INDIGO_MCP_TOKEN`. |
| **Claude Desktop** | **Necesita un puente.** Solo sabe arrancar programas que hablan por stdio, así que en el medio corre `mcp-remote`, instalado en `C:\MCPS\indigo-mcp`. |
| **Cowork** | **No funciona todavía.** Ver abajo. |

### Cowork: por ahora no

Cowork corre del lado de Anthropic, así que no hay dónde levantar el puente, y
su alta de conectores negocia por OAuth — que este servidor **no publica**
(`/.well-known/oauth-authorization-server` redirige al login del panel). Pegar
la URL ahí no va a funcionar. Habilitarlo es un trabajo aparte: montar OAuth
sobre la sesión que el panel ya tiene.

### Si lo configurás a mano en Claude Desktop

Tres formas de arrancar el puente en Windows, y **solo una funciona**:

```jsonc
// ✗ ENOENT: en Windows npx es npx.cmd, y Node 18.20+ no ejecuta .cmd sin shell
"command": "npx"

// ✗ PEOR: arranca, loguea "Proxy established successfully"... y el stdin nunca
//   llega al puente. cmd.exe se come las lineas JSON-RPC e intenta ejecutarlas.
//   El cliente se queda esperando para siempre y los logs dicen que conecto.
"command": "cmd", "args": ["/c", "npx", ...]

// ✓ Verificado extremo a extremo contra produccion
"command": "C:\\Program Files\\nodejs\\node.exe",
"args": ["C:\\MCPS\\indigo-mcp\\node_modules\\mcp-remote\\dist\\proxy.js",
         "https://app.indigodecors.com/api/mcp",
         "--header", "Authorization:${INDIGO_AUTH}"],
"env": { "INDIGO_AUTH": "Bearer tuemail@indigodecors.com.<clave>" }
```

El token va en `env` y no en `args` a propósito: los argumentos de un proceso los
ve cualquiera en el listado de procesos de la máquina.

---

## Tu token es personal — esto importa

Cada persona tiene el suyo, y **no son intercambiables**. Dos razones:

1. **Ves lo tuyo.** El asistente consulta Odoo *como vos*, así que ve exactamente
   lo que verías entrando al panel — ni más ni menos.
2. **Queda registrado a tu nombre.** Cada cosa que le pidas figura como tuya, no
   como "el bot". Es lo que hace que después se pueda auditar quién pidió qué.

Ahora que hay herramientas que escriben, esto pesa más que antes: con tu token
el asistente puede mover una orden de etapa. **No lo compartas.** Si se te
escapa, avisá y se revoca en un minuto.

---

## Qué le podés pedir

No hace falta que nombres las herramientas — le hablás normal y él elige.

**Consultar (8)**

| Herramienta | Preguntas que resuelve |
|---|---|
| `today_board` | *"¿Qué hay para pintar hoy?"* · *"¿Cómo viene el tablero?"* |
| `find_orders` | *"¿En qué está la orden de Pérez?"* · *"Mostrame las de Lock Tight"* |
| `get_order` | *"Dame el detalle completo de la orden 412"* |
| `list_stages` | Las 13 etapas del flujo, en orden |
| `list_dealers` | Los dealers y su precio por SQF |
| `list_designs` | Los códigos del catálogo |
| `list_people` | Quién es quién y qué rol tiene |
| `query_data` | La consulta suelta que ninguna de las otras cubre |

Las de listar existen para que el asistente **no invente**: si le preguntás por
un diseño, mira la lista real en vez de inventarse un `ID99`.

**Escribir (5)** — `advance_order`, `assign_order`, `schedule_install`,
`hold_order`, `add_note`.

Todas piden **confirmación antes de ejecutar**: primero te muestran qué van a
hacer, y recién si decís que sí lo hacen. Y aunque el puente se equivocara,
**Odoo aplica tus permisos igual**: si tu rol no puede mover esa etapa, la
escritura se frena del otro lado.

---

## Si algo falla

| Lo que ves | Qué pasó |
|---|---|
| `Token invalido` (401) | Mal copiado o revocado. Fijate que esté entero, con el email adelante. |
| `[PERMISO_DENEGADO]` (403) | Tu cuenta no es de uso interno, o Odoo no te deja ver eso. |
| `[TRANSITORIO]` (503) | Odoo no responde. No es tu token — esperá y reintentá. |
| `MCP deshabilitado` (503) | Está apagado a propósito. Avisá. |
| `429` | Demasiadas consultas seguidas desde tu conexión. Esperá unos segundos. |
| El asistente "conecta" pero nunca contesta | Casi siempre es el `cmd /c npx` de arriba. Usá el script. |

Si el asistente te muestra un tablero y dice que está **truncado**, es porque
hay más de lo que entró en una consulta. Pedile que afine la búsqueda —
por dealer o por cliente — en vez de tomar esa lista como completa.

---

## Para Luis — operación

- **Interruptor:** `MCP_ENABLED` en Coolify (recurso `qjalaa0kakcwbjkb1t3j2tqg`).
  Sin ella, o en cualquier valor que no sea `true`, el endpoint responde 503.
  Apagar no requiere desplegar, solo reiniciar el contenedor.
- **Cómo saber si está encendido sin token:** un POST cualquiera devuelve
  `401 Token invalido` si está vivo, `503 MCP deshabilitado` si está apagado.
- **Auditoría:** cada llamada deja una línea JSON en los logs del contenedor con
  `{ts, uid, login, tool, args, ok, ms}` → `docker logs <container> | grep '"tool"'`.
- **Revocar a una persona:** borrar su clave API en Odoo. Efecto inmediato, no
  hace falta desplegar. (Verificado: tras el `unlink`, el token da 401 al instante.)
- **Emitir una clave para alguien sin pasar por la UI:** `res.users.apikeys`
  `.with_user(u)._generate("rpc", "<nombre>", False)` en `odoo shell`, y
  `env.cr.commit()` — el shell no commitea solo.
- **Re-verificar que sigue sano:** `node scripts/mcp-eval.mjs` con `MCP_URL`,
  `MCP_TOKEN`, `ODOO_URL` y `ODOO_DB` seteados. 13 escenarios; uno comprueba que
  Odoo sigue rechazando escrituras no autorizadas.
- **`GET /api/mcp` devuelve 405 y está bien:** el spec permite que un servidor
  sin stream SSE lo rechace, y los clientes caen a POST solo.
- **Rate limit (activo).** 30 req/min por IP con ráfaga de 10 (capacidad 40),
  aplicado **antes** de tocar Odoo — que corre con `workers=0` y comparte ese
  único worker con la tienda y el portal de dealers. Al pasarse: HTTP 429 con
  `Retry-After`, y una línea `{"reason":"rate_limited"}` en los logs. Se ajusta
  con `MCP_RATE_LIMIT_PER_MINUTE`, `MCP_RATE_LIMIT_BURST` y
  `MCP_RATE_LIMIT_MAX_BUCKETS`.
  - La IP sale de `x-real-ip` (la escribe Traefik) o, si falta, del **último**
    salto de `x-forwarded-for`. El primer salto lo elige quien llama, así que
    usarlo daba un balde nuevo por request.
  - Es memoria del proceso: al reiniciar el contenedor los baldes se vacían, y
    con más de una réplica cada una lleva el suyo. Suficiente para lo que
    protege; si alguna vez hace falta exacto, hay que mover el estado a Redis.
- **Si el panel se pone lento mientras alguien usa el asistente:** mirar primero
  los logs por `rate_limited` y por líneas `"tool"` seguidas. Cada request cuesta
  dos llamadas a Odoo antes de hacer trabajo útil.
