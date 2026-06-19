import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

interface RateRow {
  id: number;
  name: string;
  contractor_type: "painter" | "installer" | "other";
  rate: number;
  rate_unit: "sqf" | "piece";
  active: boolean;
}

/** Parse a raw param string to a positive number, else fall back. */
function numOr(v: string | undefined, fallback: number): number {
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

    const [caps, rates] = await Promise.all([
      // Read via a sudo'd, manager-gated method so plain managers (who can't
      // read ir.config_parameter directly) can load Settings.
      call<{ cnc: string; painting: string; install: string }>({
        session: s.session,
        model: "ir.config_parameter",
        method: "indigo_get_capacities",
        args: [],
        kwargs: {},
      }),
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
      capacities: {
        cnc: numOr(caps.cnc, 8),
        painting: numOr(caps.painting, 200),
        install: numOr(caps.install, 5),
      },
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
      // Persist via the sudo'd, manager-gated method (managers can't write
      // ir.config_parameter directly).
      await call({
        session: s.session,
        model: "ir.config_parameter",
        method: "indigo_set_capacities",
        args: [
          {
            cnc: body.capacities.cnc,
            painting: body.capacities.painting,
            install: body.capacities.install,
          },
        ],
        kwargs: {},
      });
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
    const [caps, rates] = await Promise.all([
      call<{ cnc: string; painting: string; install: string }>({
        session: s.session,
        model: "ir.config_parameter",
        method: "indigo_get_capacities",
        args: [],
        kwargs: {},
      }),
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
      capacities: {
        cnc: numOr(caps.cnc, 8),
        painting: numOr(caps.painting, 200),
        install: numOr(caps.install, 5),
      },
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
