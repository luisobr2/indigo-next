/**
 * The MCP error contract, extracted from tools.ts so modules that tools.ts
 * itself imports (query.ts) can raise contract-shaped errors without an
 * import cycle. tools.ts re-exports all three names, so every existing
 * importer keeps working unchanged.
 *
 * Every failure a tool raises reaches the agent as actionable Spanish text
 * prefixed with a stable "[CODIGO] mensaje", so the agent can branch on the
 * code (retry vs. ask the user vs. give up) without parsing prose or
 * guessing what language Odoo happened to answer in. Never forwards an Odoo
 * traceback — rpc.ts already only ever throws `error.data.message` (never
 * `.debug`), and that property is preserved here.
 */

export class McpToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "McpToolError";
    this.code = code;
  }
}

/** Builds a stable-coded, Spanish, actionable tool error. */
export function mcpError(code: string, message: string): McpToolError {
  return new McpToolError(code, message);
}

/**
 * Maps whatever a tool implementation throws onto the error contract.
 * `OdooRpcError.errorName` carries Odoo's own exception dotted name (see
 * src/lib/odoo/rpc.ts) — duck-typed on `.name`/`.errorName`/`.httpStatus`
 * rather than `instanceof` so this module doesn't need a top-level import
 * of rpc.ts (tools.ts only ever reaches Odoo through the lazy getRpc()).
 */
export function toMcpToolError(e: unknown): McpToolError {
  if (e instanceof McpToolError) return e;

  if (e instanceof Error && e.name === "OdooRpcError") {
    const err = e as Error & { errorName?: string; httpStatus?: number };
    if (err.errorName === "TIMEOUT" || err.errorName === "NETWORK") {
      return mcpError("TRANSITORIO", "Odoo no respondió a tiempo. Intenta de nuevo en unos segundos.");
    }
    if (typeof err.httpStatus === "number" && err.httpStatus >= 500) {
      return mcpError("TRANSITORIO", "Odoo devolvió un error de servidor. Intenta de nuevo en unos segundos.");
    }
    if (err.errorName === "odoo.exceptions.AccessError") {
      return mcpError("PERMISO_DENEGADO", "No tienes permiso en Odoo para ver estos datos.");
    }
    if (err.errorName === "odoo.exceptions.MissingError") {
      return mcpError("NO_ENCONTRADO", "El registro solicitado ya no existe en Odoo.");
    }
    return mcpError("ERROR_ODOO", `Odoo devolvió un error: ${err.message}`);
  }

  const message = e instanceof Error ? e.message : "Error inesperado.";
  return mcpError("ERROR_ODOO", message);
}
