import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/contractors
 *
 * Returns lists of partners that can be assigned as painter / installer
 * on an order. Pulls from indigo.contractor.rate to know who is active.
 *
 * Falls back to res.users-derived partners by group membership in case
 * the contractor.rate model isn't populated for a tenant.
 */
export async function GET() {
  try {
    const s = await requireSession();

    interface RateRow {
      id: number;
      contractor_type: "painter" | "installer" | "other";
      active: boolean;
    }
    const rates = await call<RateRow[]>({
      session: s.session,
      model: "indigo.contractor.rate",
      method: "search_read",
      args: [
        [["active", "=", true]],
        ["id", "contractor_type", "active"],
      ],
      kwargs: { limit: 200 },
    });

    // Pull every internal user + portal user that has the Painter or
    // Installer group. The contractor.rate model isn't tied to a partner
    // directly — workers are picked from res.partner / res.users by role.
    interface UserRow {
      id: number;
      name: string;
      login: string;
      partner_id: [number, string] | false;
      groups_id: number[];
    }
    const users = await call<UserRow[]>({
      session: s.session,
      model: "res.users",
      method: "search_read",
      args: [
        [["active", "=", true], ["login", "!=", "default"], ["login", "!=", "public"], ["login", "!=", "portaltemplate"]],
        ["id", "name", "login", "partner_id", "groups_id"],
      ],
      kwargs: { limit: 200 },
    });

    interface GroupRow {
      id: number;
      name: { en_US?: string } | string;
    }
    const groups = await call<GroupRow[]>({
      session: s.session,
      model: "res.groups",
      method: "search_read",
      args: [[["category_id.name", "=", "Indigo Decors"]], ["id", "name"]],
      kwargs: { limit: 50 },
    });

    const norm = (n: GroupRow["name"]) =>
      typeof n === "string" ? n : (n?.en_US ?? "");

    const painterGroupIds = groups
      .filter((g) => norm(g.name).toLowerCase().includes("pintor") || norm(g.name).toLowerCase().includes("painter"))
      .map((g) => g.id);
    const installerGroupIds = groups
      .filter((g) => {
        const label = norm(g.name).toLowerCase();
        return label.includes("instalador") || label.includes("installer") || label.includes("contractor");
      })
      .map((g) => g.id);

    const painters = users
      .filter((u) => u.partner_id && u.groups_id.some((g) => painterGroupIds.includes(g)))
      .map((u) => ({
        id: (u.partner_id as [number, string])[0],
        name: u.name,
        login: u.login,
      }));
    const installers = users
      .filter((u) => u.partner_id && u.groups_id.some((g) => installerGroupIds.includes(g)))
      .map((u) => ({
        id: (u.partner_id as [number, string])[0],
        name: u.name,
        login: u.login,
      }));

    return NextResponse.json({
      painters,
      installers,
      rateCount: rates.length,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
