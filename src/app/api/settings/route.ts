import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/** Keys stored in ir.config_parameter for production capacities. */
const CAP_KEYS = {
  cnc: "indigo_decors.capacity.cnc_per_day",
  painting: "indigo_decors.capacity.painting_sqf_per_day",
  install: "indigo_decors.capacity.installations_per_day",
} as const;

interface RateRow {
  id: number;
  name: string;
  contractor_type: "painter" | "installer" | "other";
  rate: number;
  rate_unit: "sqf" | "piece";
  active: boolean;
}

/** Helper: read an ir.config_parameter value via session. Defaults if blank. */
async function readParam(session: string, key: string, fallback: number): Promise<number> {
  const v = await call<string | false>({
    session,
    model: "ir.config_parameter",
    method: "get_param",
    args: [key, ""],
    kwargs: {},
  });
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * GET /api/settings — returns:
 *   capacities: { cnc, painting, install }
 *   rates: indigo.contractor.rate records (active + archived)
 */
export async function GET() {
  try {
    const s = await requireSession();

    const [cnc, painting, install, rates] = await Promise.all([
      readParam(s.session, CAP_KEYS.cnc, 8),
      readParam(s.session, CAP_KEYS.painting, 200),
      readParam(s.session, CAP_KEYS.install, 5),
      call<RateRow[]>({
        session: s.session,
        model: "indigo.contractor.rate",
        method: "search_read",
        args: [
          [],
          ["id", "name", "contractor_type", "rate", "rate_unit", "active"],
        ],
        kwargs: { order: "contractor_type, id", limit: 200 },
      }),
    ]);

    return NextResponse.json({
      capacities: { cnc, painting, install },
      rates,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

interface PutBody {
  capacities?: { cnc?: number; painting?: number; install?: number };
  rates?: Array<Partial<RateRow> & { id?: number; _delete?: boolean }>;
}

/**
 * PUT /api/settings — accepts:
 *   { capacities: { cnc, painting, install }, rates: [...] }
 *
 * Capacities -> set_param. Rates -> create / write / unlink per record.
 * Returns the refreshed shape for client cache update.
 */
export async function PUT(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as PutBody;

    // Validate before writing: capacities must be positive (the dashboard
    // divides by them) and rates can't be negative / nameless.
    if (body.capacities) {
      for (const [k, v] of Object.entries(body.capacities)) {
        if (v == null) continue;
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
          return NextResponse.json(
            { error: `Capacity "${k}" must be a number greater than 0.` },
            { status: 400 },
          );
        }
      }
    }
    if (body.rates) {
      for (const r of body.rates) {
        if (r._delete) continue;
        if (typeof r.rate === "number" && (!Number.isFinite(r.rate) || r.rate < 0)) {
          return NextResponse.json(
            { error: "Contractor rate can't be negative." },
            { status: 400 },
          );
        }
        if (!r.id && !(r.name && r.name.trim())) {
          return NextResponse.json(
            { error: "New contractor rate needs a name." },
            { status: 400 },
          );
        }
      }
    }

    if (body.capacities) {
      const ops: Array<Promise<unknown>> = [];
      if (typeof body.capacities.cnc === "number") {
        ops.push(call({
          session: s.session,
          model: "ir.config_parameter",
          method: "set_param",
          args: [CAP_KEYS.cnc, String(body.capacities.cnc)],
          kwargs: {},
        }));
      }
      if (typeof body.capacities.painting === "number") {
        ops.push(call({
          session: s.session,
          model: "ir.config_parameter",
          method: "set_param",
          args: [CAP_KEYS.painting, String(body.capacities.painting)],
          kwargs: {},
        }));
      }
      if (typeof body.capacities.install === "number") {
        ops.push(call({
          session: s.session,
          model: "ir.config_parameter",
          method: "set_param",
          args: [CAP_KEYS.install, String(body.capacities.install)],
          kwargs: {},
        }));
      }
      await Promise.all(ops);
    }

    if (body.rates) {
      for (const r of body.rates) {
        if (r._delete && r.id) {
          await call({
            session: s.session,
            model: "indigo.contractor.rate",
            method: "unlink",
            args: [[r.id]],
            kwargs: {},
          });
          continue;
        }
        const vals = {
          name: r.name,
          contractor_type: r.contractor_type,
          rate: r.rate,
          rate_unit: r.rate_unit,
          active: r.active ?? true,
        };
        if (r.id) {
          await call({
            session: s.session,
            model: "indigo.contractor.rate",
            method: "write",
            args: [[r.id], vals],
            kwargs: {},
          });
        } else {
          if (!vals.name || !vals.contractor_type || vals.rate == null) continue;
          await call({
            session: s.session,
            model: "indigo.contractor.rate",
            method: "create",
            args: [vals],
            kwargs: {},
          });
        }
      }
    }

    // Refresh and return
    const [cnc, painting, install, rates] = await Promise.all([
      readParam(s.session, CAP_KEYS.cnc, 8),
      readParam(s.session, CAP_KEYS.painting, 200),
      readParam(s.session, CAP_KEYS.install, 5),
      call<RateRow[]>({
        session: s.session,
        model: "indigo.contractor.rate",
        method: "search_read",
        args: [
          [],
          ["id", "name", "contractor_type", "rate", "rate_unit", "active"],
        ],
        kwargs: { order: "contractor_type, id", limit: 200 },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      capacities: { cnc, painting, install },
      rates,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
