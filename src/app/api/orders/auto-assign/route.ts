import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * Auto-assign orphan painter/installer fields.
 *
 * Scope:
 *   - Painter orphans = orders whose stage has already reached `cnc`
 *     or later AND painter_id is empty. The order is heading toward
 *     Painting (or already past) so a contractor must be set if we
 *     want a payout when the stage trigger fires.
 *   - Installer orphans = orders whose stage is `ready_install` or
 *     later AND installer_ids is empty.
 *
 * Picks the FIRST active painter (by id) for painter orphans and the
 * first active installer for installer orphans. Caller can re-run any
 * time to refresh the assignment.
 *
 * GET  → preview { orphanPainters, orphanInstallers, defaults }
 * POST → applies the assignment and returns the counts that were touched
 */

const PAINTER_STAGES = ["cnc", "painting", "ready_install", "install_scheduled", "installed", "invoiced"];
const INSTALLER_STAGES = ["ready_install", "install_scheduled", "installed", "invoiced"];

interface UserRow {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  groups_id: number[];
}

interface GroupRow {
  id: number;
  name: { en_US?: string } | string;
}

async function getContractorPartners(session: string) {
  const users = await call<UserRow[]>({
    session,
    model: "res.users",
    method: "search_read",
    args: [
      [
        ["active", "=", true],
        ["login", "!=", "default"],
        ["login", "!=", "public"],
        ["login", "!=", "portaltemplate"],
      ],
      ["id", "name", "partner_id", "groups_id"],
    ],
    kwargs: { limit: 200 },
  });
  const groups = await call<GroupRow[]>({
    session,
    model: "res.groups",
    method: "search_read",
    args: [[["category_id.name", "=", "Indigo Decors"]], ["id", "name"]],
    kwargs: { limit: 50 },
  });
  const norm = (n: GroupRow["name"]) =>
    typeof n === "string" ? n : (n?.en_US ?? "");
  const painterGroupIds = groups
    .filter((g) => /pintor|painter/i.test(norm(g.name)))
    .map((g) => g.id);
  const installerGroupIds = groups
    .filter((g) => /instalador|installer|contractor/i.test(norm(g.name)))
    .map((g) => g.id);
  const painters = users
    .filter((u) => u.partner_id && u.groups_id.some((g) => painterGroupIds.includes(g)))
    .sort((a, b) => a.id - b.id);
  const installers = users
    .filter((u) => u.partner_id && u.groups_id.some((g) => installerGroupIds.includes(g)))
    .sort((a, b) => a.id - b.id);
  return {
    painters: painters.map((u) => ({
      id: (u.partner_id as [number, string])[0],
      name: u.name,
    })),
    installers: installers.map((u) => ({
      id: (u.partner_id as [number, string])[0],
      name: u.name,
    })),
  };
}

export async function GET() {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { painters, installers } = await getContractorPartners(s.session);

    const orphanPainters = await call<Array<{ id: number; name: string }>>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["painter_id", "=", false],
          ["stage_id.code", "in", PAINTER_STAGES],
        ],
        ["id", "name"],
      ],
      kwargs: { limit: 5000 },
    });

    const orphanInstallers = await call<Array<{ id: number; name: string }>>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["installer_ids", "=", false],
          ["stage_id.code", "in", INSTALLER_STAGES],
        ],
        ["id", "name"],
      ],
      kwargs: { limit: 5000 },
    });

    return NextResponse.json({
      orphanPainters,
      orphanInstallers,
      defaults: {
        painter: painters[0] ?? null,
        installer: installers[0] ?? null,
      },
      pools: { painters, installers },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { painters, installers } = await getContractorPartners(s.session);
    const defaultPainter = painters[0] ?? null;
    const defaultInstaller = installers[0] ?? null;

    let painterUpdates = 0;
    let installerUpdates = 0;

    if (defaultPainter) {
      const orphans = await call<Array<{ id: number }>>({
        session: s.session,
        model: "indigo.order",
        method: "search_read",
        args: [
          [
            ["painter_id", "=", false],
            ["stage_id.code", "in", PAINTER_STAGES],
          ],
          ["id"],
        ],
        kwargs: { limit: 5000 },
      });
      if (orphans.length) {
        await call({
          session: s.session,
          model: "indigo.order",
          method: "write",
          args: [orphans.map((o) => o.id), { painter_id: defaultPainter.id }],
          kwargs: {},
        });
        painterUpdates = orphans.length;
      }
    }

    if (defaultInstaller) {
      const orphans = await call<Array<{ id: number }>>({
        session: s.session,
        model: "indigo.order",
        method: "search_read",
        args: [
          [
            ["installer_ids", "=", false],
            ["stage_id.code", "in", INSTALLER_STAGES],
          ],
          ["id"],
        ],
        kwargs: { limit: 5000 },
      });
      if (orphans.length) {
        // Many2many command (6, 0, ids) replaces the set.
        for (const o of orphans) {
          await call({
            session: s.session,
            model: "indigo.order",
            method: "write",
            args: [[o.id], { installer_ids: [[6, 0, [defaultInstaller.id]]] }],
            kwargs: {},
          });
        }
        installerUpdates = orphans.length;
      }
    }

    return NextResponse.json({
      ok: true,
      painterUpdates,
      installerUpdates,
      defaultPainter,
      defaultInstaller,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
