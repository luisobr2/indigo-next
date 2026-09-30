import { NextResponse } from "next/server";
import { OdooError } from "@/lib/odoo/client";

/**
 * The HTTP status an Odoo failure deserves. A UserError / ValidationError is
 * Odoo refusing on a business rule ("choose who painted it"): the person can
 * fix it, so it's a 400 carrying Odoo's sentence, not a 500. An AccessError
 * is a 403. Anything else stays a 500.
 */
export function odooErrorStatus(e: unknown): number {
  if (e instanceof OdooError) {
    const code = String(e.code || "");
    if (/AccessError|AccessDenied/.test(code)) return 403;
    if (/UserError|ValidationError|MissingError/.test(code)) return 400;
  }
  return 500;
}

/** Route catch-all: the Odoo message with the status it deserves. */
export function odooErrorResponse(e: unknown, fallback = "Error"): NextResponse {
  if (e instanceof Response) return e as NextResponse;
  return NextResponse.json(
    { error: e instanceof Error ? e.message : fallback },
    { status: odooErrorStatus(e) },
  );
}
