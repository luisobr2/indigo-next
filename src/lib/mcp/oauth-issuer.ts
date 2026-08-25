/**
 * De donde cuelga el servidor OAuth, visto desde afuera.
 *
 * Se deriva de la propia peticion en vez de una variable de entorno porque
 * TODAS las URLs que publica el descubrimiento tienen que coincidir con el
 * host por el que el cliente llego: si el metadata anuncia
 * `https://app.indigodecors.com/...` y el cliente entro por la IP de respaldo,
 * el redirect_uri no valida y el flujo muere con un error que no dice nada.
 *
 * Detras de Traefik el esquema real viene en `x-forwarded-proto`; `req.url`
 * dice `http` porque el TLS termina en el proxy.
 */
export function issuerFrom(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return (process.env.PUBLIC_PANEL_URL ?? "https://app.indigodecors.com").replace(/\/+$/, "");
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  return `${proto}://${host}`;
}

/** El "resource" del MCP en el sentido de RFC 8707: el endpoint protegido. */
export function mcpResource(req: Request): string {
  return `${issuerFrom(req)}/api/mcp`;
}
