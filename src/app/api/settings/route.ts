import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

interface RateRow {
  id: number;
  name: string;
  contractor_type: "painter" | "installer" | "other";
  /** partner this rule belongs to; false = the fallback rule for the type. */
  partner_id: [number, string] | false;
  rate: number;
  rate_unit: "sqf" | "piece";
  /** Floor for one worked day. 0 = no floor. With rate 0, this IS the day rate. */
  daily_minimum: number;
  /** Added ON TOP of the floor — travel money, not part of the guarantee. */
  bonus_amount: number;
  bonus_unit: "order" | "door";
  active: boolean;
}

/** Read once for the GET and again after a save — keep the two in step. */
const RATE_FIELDS = [
  "id",
  "name",
  "contractor_type",
  "partner_id",
  "rate",
  "rate_unit",
  "daily_minimum",
  "bonus_amount",
  "bonus_unit",
  "active",
];

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
        args: [[], RATE_FIELDS],
        kwargs: { order: "contractor_type, partner_id, id", limit: 200 },
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
  rates?: Array<
    Omit<Partial<RateRow>, "partner_id"> & {
      id?: number;
      _delete?: boolean;
      /** Inbound it is a bare partner id (null clears it); Odoo reads it
       *  back out as the [id, name] pair, hence the Omit above. */
      partner_id?: number | null;
    }
  >;
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
        // Every money field gets the same guard. A negative minimum or bonus
        // would quietly subtract from what a contractor is owed.
        for (const [label, value] of [
          ["rate", r.rate],
          ["daily minimum", r.daily_minimum],
          ["bonus", r.bonus_amount],
        ] as Array<[string, unknown]>) {
          if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
            return NextResponse.json(
              { error: `Contractor ${label} can't be negative.` },
              { status: 400 },
            );
          }
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
          // false clears it — that turns the row into the fallback rule
          // for its contractor type, which is a legitimate thing to want.
          partner_id: r.partner_id ?? false,
          rate: r.rate,
          rate_unit: r.rate_unit,
          daily_minimum: r.daily_minimum ?? 0,
          bonus_amount: r.bonus_amount ?? 0,
          bonus_unit: r.bonus_unit ?? "order",
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
        args: [[], RATE_FIELDS],
        kwargs: { order: "contractor_type, partner_id, id", limit: 200 },
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
