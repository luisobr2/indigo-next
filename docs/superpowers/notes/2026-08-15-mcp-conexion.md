# Conectar el asistente al sistema Indigo (MCP)

**Para:** Majela, Javier — y quien más del equipo lo necesite.
**Qué es:** un puente que deja que un asistente de IA (Claude Cowork, Codex y
similares) *consulte* el sistema. Esta primera versión es de **solo lectura**:
el asistente puede mirar todo lo que vos podés mirar, y no puede cambiar nada.

---

## Los datos de conexión

| | |
|---|---|
| **URL** | `https://app.indigodecors.com/api/mcp` |
| **Tipo** | Servidor MCP remoto (HTTP) |
| **Autenticación** | Bearer token |
| **Token** | El tuyo, personal — te lo pasa Luis |

El token tiene la forma `tuemail@indigodecors.com.<clave larga>`. Va **entero**,
tal cual, incluido el email. No lo cortes por el punto.

En el cliente que uses, el header es:

```
Authorization: Bearer majela@indigodecors.com.<tu clave>
```

## Tu token es personal — esto importa

Cada persona tiene el suyo, y **no son intercambiables**. Dos razones:

1. **Ves lo tuyo.** El asistente consulta Odoo *como vos*, así que ve exactamente
   lo que verías entrando al panel — ni más ni menos. Si un día alguien del
   taller usa el suyo, va a ver solo su área.
2. **Queda registrado a tu nombre.** Si le pedís algo al asistente, en el sistema
   figura como tuyo, no como "el bot". Es lo que hace que después se pueda
   auditar quién pidió qué.

Por eso: **no compartas tu token.** Si se te escapa, avisale a Luis y se
revoca en un minuto (Odoo → Ajustes → Seguridad → claves API).

---

## Qué le podés preguntar

El asistente tiene seis herramientas. No hace falta que las nombres — le hablás
normal y él elige:

| Herramienta | Preguntas que resuelve |
|---|---|
| `today_board` | *"¿Qué hay para pintar hoy?"* · *"¿Cómo viene el tablero?"* |
| `find_orders` | *"¿En qué está la orden de Pérez?"* · *"Mostrame las de Lock Tight"* |
| `get_order` | *"Dame el detalle completo de la orden 412"* |
| `list_stages` | Las 13 etapas del flujo, en orden |
| `list_dealers` | Los dealers y su precio por SQF |
| `list_designs` | Los códigos del catálogo — 163 hoy |

Las tres últimas existen para que el asistente **no invente**. Si le preguntás
por un diseño, primero mira la lista real en vez de inventarse un `ID99`.

## Qué NO puede hacer

- **No cambia nada.** No crea órdenes, no mueve etapas, no toca pagos, no
  borra. Aunque se lo pidas.
- Esto no es una restricción del asistente: **Odoo mismo lo rechaza**. Aunque
  hubiera un error en el puente, la escritura se frena del otro lado.
- Escribir llega en una fase posterior, y va a tener confirmación antes de
  cada acción que no se pueda deshacer.

## Si algo falla

| Lo que ves | Qué pasó |
|---|---|
| `Token invalido` (401) | El token está mal copiado o fue revocado. Fijate que esté entero, con el email adelante. |
| `[PERMISO_DENEGADO]` (403) | Tu cuenta no es de uso interno, o Odoo no te deja ver eso. |
| `[TRANSITORIO]` (503) | Odoo no está respondiendo. No es tu token — esperá y reintentá. |
| `MCP deshabilitado` (503) | Está apagado a propósito. Avisale a Luis. |

Si el asistente te muestra un tablero y dice que está **truncado**, es porque
hay más de lo que entró en una consulta. Pedile que afine la búsqueda —
por dealer o por cliente — en vez de tomar esa lista como completa.

---

## Para Luis — operación

- **Interruptor:** la variable `MCP_ENABLED` en Coolify (recurso
  `qjalaa0kakcwbjkb1t3j2tqg`). Sin ella, o en cualquier valor que no sea
  `true`, el endpoint responde 503. Apagar no requiere desplegar, solo
  reiniciar el contenedor.
- **Auditoría:** cada llamada deja una línea JSON en los logs del contenedor
  con `{ts, uid, login, tool, args, ok, ms}`. Para ver quién preguntó qué:
  `docker logs <container> | grep '"tool"'`.
- **Revocar a una persona:** borrar su clave API en Odoo. Efecto inmediato, no
  hace falta desplegar.
- **Re-verificar que sigue sano:** `node scripts/mcp-eval.mjs` con `MCP_URL`,
  `MCP_TOKEN`, `ODOO_URL` y `ODOO_DB` seteados. 13 escenarios; uno de ellos
  comprueba que Odoo sigue rechazando escrituras.
- **Rate limit (activo).** 30 req/min por IP con ráfaga de 10 (capacidad 40),
  aplicado **antes** de tocar Odoo — que corre con `workers=0` y comparte ese
  único worker con la tienda y el portal de dealers. Al pasarse: HTTP 429 con
  `Retry-After`, y una línea `{"reason":"rate_limited"}` en los logs. Se ajusta
  con `MCP_RATE_LIMIT_PER_MINUTE`, `MCP_RATE_LIMIT_BURST` y
  `MCP_RATE_LIMIT_MAX_BUCKETS` (variables de Coolify).
  - La IP sale de `x-real-ip` (la escribe Traefik) o, si falta, del **último**
    salto de `x-forwarded-for`. El primer salto lo elige quien llama, así que
    usarlo daba un balde nuevo por request.
  - Es memoria del proceso: al reiniciar el contenedor los baldes se vacían, y
    con más de una réplica cada una lleva el suyo. Suficiente para lo que
    protege; si alguna vez hace falta exacto, hay que mover el estado a Redis.
- **Si el panel se pone lento mientras alguien usa el asistente:** mirar
  primero los logs por `rate_limited` y por líneas `"tool"` seguidas. Cada
  request cuesta dos llamadas a Odoo antes de hacer trabajo útil.
