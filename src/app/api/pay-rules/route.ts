import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import type { PayRule } from "@/lib/pay-rules";

export const runtime = "nodejs";

/**
 * GET /api/pay-rules
 *
 * The configured contractor pay rules, so no screen has to hardcode a rate.
 * Before this existed the Installations board multiplied doors by a literal
 * 35 and the painter worksheet printed a literal $8 — both silently wrong
 * the moment anyone edited the rates in Settings, and the worksheet is a
 * document the painter is paid from.
 *
 * WHO SEES WHAT. Rates are compensation, so the same line the rest of the
 * app draws applies: managers/office/admin see every rule; anyone else sees
 * only the rules that govern their OWN pay — their personal rule plus the
 * fallback for their contractor type. A painter must not be able to read
 * what an installer earns, or vice versa.
 */

interface RateRow {
  id: number;
  name: string;
  contractor_type: "painter" | "installer" | "other";
  partner_id: [number, string] | false;
  rate: number;
  rate_unit: "sqf" | "piece";
  daily_minimum: number;
  bonus_amount: number;
  bonus_unit: "order" | "door";
}

export interface PayRuleRow extends PayRule {
  id: number;
  name: string;
  contractorType: RateRow["contractor_type"];
  partnerName: string | null;
  rateUnit: RateRow["rate_unit"];
}

export async function GET() {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    const seesAll = role.isManager || role.isOffice || s.user.isAdmin;

    const rows = await call<RateRow[]>({
      session: s.session,
      model: "indigo.contractor.rate",
      method: "search_read",
      args: [
        [["active", "=", true]],
        [
          "id",
          "name",
          "contractor_type",
          "partner_id",
          "rate",
          "rate_unit",
          "daily_minimum",
          "bonus_amount",
          "bonus_unit",
        ],
      ],
      kwargs: { order: "contractor_type, partner_id, id", limit: 200 },
    });

    const myPartner = s.user.partnerId ?? -1;
    // Which contractor types this person is one of. A rule for a type they
    // don't work under tells them nothing they need and isn't theirs to see.
    const myTypes = new Set<RateRow["contractor_type"]>();
    if (role.isPainter) myTypes.add("painter");
    if (role.isInstaller) myTypes.add("installer");

    const visible = seesAll
      ? rows
      : rows.filter(
          (r) =>
            myTypes.has(r.contractor_type) &&
            // Their own rule, or the fallback that would apply to them.
            (!r.partner_id || r.partner_id[0] === myPartner),
        );

    const rules: PayRuleRow[] = visible.map((r) => ({
      id: r.id,
      name: r.name,
      contractorType: r.contractor_type,
      partnerId: Array.isArray(r.partner_id) ? r.partner_id[0] : null,
      partnerName: Array.isArray(r.partner_id) ? r.partner_id[1] : null,
      ratePerDoor: r.rate,
      rateUnit: r.rate_unit,
      dailyMinimum: r.daily_minimum,
      bonusAmount: r.bonus_amount,
      bonusUnit: r.bonus_unit,
    }));

    return NextResponse.json({ rules });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
