import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * POST /api/installers
 *
 * Creates a portal res.users account with the Installer group, so the
 * worker can log in to the field-facing portal AND show up in the
 * order assignment dropdown.
 *
 * Body:
 *   { name: string,
 *     login: string,    // email
 *     password?: string // optional — defaults to a generated 12-char }
 *
 * Only managers / office / admin can call this.
 */
export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as {
      name?: string;
      login?: string;
      password?: string;
    };
    const name = (body.name || "").trim();
    const login = (body.login || "").trim().toLowerCase();
    if (!name || !login) {
      return NextResponse.json(
        { error: "name and login (email) are required" },
        { status: 400 },
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) {
      return NextResponse.json(
        { error: "login must be a valid email address" },
        { status: 400 },
      );
    }

    // Resolve the Installer / Instalador group id by category name +
    // group label match. Same pattern as /api/contractors.
    interface GroupRow {
      id: number;
      name: { en_US?: string } | string;
    }
    const groups = await call<GroupRow[]>({
      session: s.session,
      model: "res.groups",
      method: "search_read",
      args: [
        [["category_id.name", "=", "Indigo Decors"]],
        ["id", "name"],
      ],
      kwargs: { limit: 50 },
    });
    const norm = (n: GroupRow["name"]) =>
      typeof n === "string" ? n : (n?.en_US ?? "");
    const installerGroupId = groups.find((g) => {
      const label = norm(g.name).toLowerCase();
      return label.includes("instalador") || label.includes("installer");
    })?.id;
    if (!installerGroupId) {
      return NextResponse.json(
        {
          error:
            "Installer group not found in Odoo. Re-run the module install or create the group manually.",
        },
        { status: 500 },
      );
    }

    // Refuse if a user with that login already exists.
    const existing = await call<Array<{ id: number }>>({
      session: s.session,
      model: "res.users",
      method: "search_read",
      args: [[["login", "=", login]], ["id"]],
      kwargs: { limit: 1 },
    });
    if (existing.length) {
      return NextResponse.json(
        { error: `A user with login "${login}" already exists.` },
        { status: 409 },
      );
    }

    // Generate a password if the caller didn't provide one.
    const password =
      body.password && body.password.length >= 8
        ? body.password
        : Array.from(
            crypto.getRandomValues(new Uint8Array(9)),
            (b) => "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"[b % 56],
          ).join("");

    const userId = await call<number>({
      session: s.session,
      model: "res.users",
      method: "create",
      args: [
        {
          name,
          login,
          password,
          // Portal users only — no internal app license needed.
          groups_id: [[6, 0, [installerGroupId]]],
          notification_type: "email",
        },
      ],
      kwargs: {},
    });

    return NextResponse.json({
      ok: true,
      userId,
      login,
      // Surface the generated password back to the caller ONCE so the
      // manager can give it to the installer. The frontend should show
      // it in a copy-able field then drop it from memory.
      password,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
