import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

const INSTALLER_RATE_PER_DOOR = 35;

// Stages the dashboard counts as "Installations Pending". Kept in sync with
// the Odoo dashboard model (PENDING_INSTALL_CODES) so the KPI on the
// dashboard reconciles with what this page can show.
const PENDING_INSTALL_CODES = ["ready_install", "install_scheduled"];

/**
 * GET /api/installers/dashboard?week=YYYY-MM-DD
 *
 * Returns the data the Installations management page needs:
 *   - per-installer buckets with their order list and KPIs
 *   - weekly KPI summary
 *   - daily breakdown for the bar chart
 *   - donut payload (installed / pending / not_started)
 *
 * `week` is the Monday of the target ISO week. If omitted we default to
 * the current week.
 */
function startOfWeek(d: Date): Date {
  // Mon as the first day so May 13 (Mon) is the bar-chart anchor.
  const day = (d.getDay() + 6) % 7;
  const r = new Date(d);
  r.setDate(d.getDate() - day);
  r.setHours(0, 0, 0, 0);
  return r;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    // The dashboard exposes payment-due figures across installers —
    // restricted to managers/office so specialists can't see each
    // others' compensation.
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const sp = req.nextUrl.searchParams;
    const weekParam = sp.get("week");
    const monday = weekParam ? startOfWeek(new Date(weekParam)) : startOfWeek(new Date());
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const mondayStr = ymd(monday);
    const sundayStr = ymd(sunday);

    interface OrderRow {
      id: number;
      name: string;
      dealer_ref: string;
      client_name: string;
      client_address: string;
      installer_ids: number[];
      door_count: number;
      installation_date: string | false;
      stage_code: string;
      total_sqf: number;
    }

    // 1. Pull every order with installation_date inside this week, regardless
    //    of stage (Pending, Scheduled, Installed). We grab a wider net for
    //    the "Pending" / "Not Started" buckets too.
    const orders = await call<OrderRow[]>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["installation_date", ">=", mondayStr],
          ["installation_date", "<=", sundayStr],
        ],
        [
          "id",
          "name",
          "dealer_ref",
          "client_name",
          "client_address",
          "installer_ids",
          "door_count",
          "installation_date",
          "stage_code",
          "total_sqf",
        ],
      ],
      kwargs: { limit: 500, order: "installation_date" },
    });

    // 1b. Pull orders that are pending installation but have NO date yet.
    //     These are counted in the dashboard "Installations Pending" KPI but
    //     never show in the weekly view — which is exactly what operators
    //     reported as "the dashboard says N pending but I can't see them".
    //     They are week-agnostic (no date), so we always return them.
    const unscheduled = await call<OrderRow[]>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["stage_id.code", "in", PENDING_INSTALL_CODES],
          ["installation_date", "=", false],
        ],
        [
          "id",
          "name",
          "dealer_ref",
          "client_name",
          "client_address",
          "installer_ids",
          "door_count",
          "installation_date",
          "stage_code",
          "total_sqf",
        ],
      ],
      kwargs: { limit: 500, order: "create_date desc" },
    });

    // 1c. Overdue: still pending-install (not yet installed) but the
    //     scheduled date is already in the past. These have a date so they
    //     fall out of "Pending Scheduling", and being in a past week they
    //     vanish from the current-week view — so they'd silently slip.
    //     Anchor "today" to the workshop's timezone (Miami / America/New_York)
    //     so a UTC server in the evening doesn't flag same-day installs as
    //     overdue. en-CA formats as YYYY-MM-DD.
    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
    }).format(new Date());
    const overdue = await call<OrderRow[]>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["stage_id.code", "in", PENDING_INSTALL_CODES],
          ["installation_date", "!=", false],
          ["installation_date", "<", todayStr],
        ],
        [
          "id",
          "name",
          "dealer_ref",
          "client_name",
          "client_address",
          "installer_ids",
          "door_count",
          "installation_date",
          "stage_code",
          "total_sqf",
        ],
      ],
      kwargs: { limit: 500, order: "installation_date" },
    });

    // 2. Resolve installer names from res.partner (since installer_ids is
    //    a m2m to res.partner via the `installer_partner_rel` table). Read
    //    them once for the whole batch (weekly + unscheduled + overdue).
    const installerIdSet = new Set<number>();
    for (const o of [...orders, ...unscheduled, ...overdue]) {
      for (const iid of o.installer_ids || []) installerIdSet.add(iid);
    }
    interface PartnerRow {
      id: number;
      name: string;
    }
    const installers = installerIdSet.size
      ? await call<PartnerRow[]>({
          session: s.session,
          model: "res.partner",
          method: "read",
          args: [Array.from(installerIdSet), ["id", "name"]],
          kwargs: {},
        })
      : [];
    const nameOf = new Map(installers.map((p) => [p.id, p.name]));

    // 3. Pull first_line per order for door_type + color (all buckets).
    const orderIds = [...orders, ...unscheduled, ...overdue].map((o) => o.id);
    interface LineRow {
      id: number;
      order_id: [number, string] | false;
      door_type?: string;
      color?: string;
    }
    const lines = orderIds.length
      ? await call<LineRow[]>({
          session: s.session,
          model: "indigo.order.line",
          method: "search_read",
          args: [
            [["order_id", "in", orderIds]],
            ["id", "order_id", "door_type", "color"],
          ],
          kwargs: { order: "order_id, id" },
        })
      : [];
    const firstLineByOrder = new Map<number, LineRow>();
    for (const l of lines) {
      const oid = l.order_id && Array.isArray(l.order_id) ? l.order_id[0] : 0;
      if (oid && !firstLineByOrder.has(oid)) firstLineByOrder.set(oid, l);
    }

    // 4. Bucket per installer.
    interface InstallerBucket {
      id: number;
      name: string;
      doors: number;
      installed: number;
      pending: number;
      paymentDue: number;
      orders: Array<{
        id: number;
        name: string;
        dealer_ref: string;
        client_name: string;
        client_address: string;
        door_type: string;
        color: string;
        qty: number;
        status: "installed" | "scheduled" | "pending";
        scheduled_date: string | false;
      }>;
    }

    const buckets = new Map<number, InstallerBucket>();
    const unassigned: InstallerBucket = {
      id: 0,
      name: "Unassigned",
      doors: 0,
      installed: 0,
      pending: 0,
      paymentDue: 0,
      orders: [],
    };

    for (const o of orders) {
      const status: "installed" | "scheduled" | "pending" =
        o.stage_code === "installed" || o.stage_code === "invoiced" || o.stage_code === "closed"
          ? "installed"
          : o.stage_code === "install_scheduled"
            ? "scheduled"
            : "pending";
      const firstLine = firstLineByOrder.get(o.id);
      const row = {
        id: o.id,
        name: o.name,
        dealer_ref: o.dealer_ref || "",
        client_name: o.client_name,
        client_address: o.client_address || "",
        door_type: firstLine?.door_type ?? "",
        color: firstLine?.color ?? "",
        qty: o.door_count || 1,
        status,
        scheduled_date: o.installation_date,
      };

      const targets = (o.installer_ids?.length ?? 0) > 0 ? o.installer_ids : [0];
      for (const iid of targets) {
        let bucket = iid === 0 ? unassigned : buckets.get(iid);
        if (!bucket) {
          bucket = {
            id: iid,
            name: nameOf.get(iid) ?? "(unknown)",
            doors: 0,
            installed: 0,
            pending: 0,
            paymentDue: 0,
            orders: [],
          };
          buckets.set(iid, bucket);
        }
        bucket.doors += row.qty;
        if (status === "installed") bucket.installed += row.qty;
        else bucket.pending += row.qty;
        bucket.orders.push(row);
        if (status === "installed") {
          bucket.paymentDue += row.qty * INSTALLER_RATE_PER_DOOR;
        }
      }
    }

    const installerBuckets = Array.from(buckets.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    if (unassigned.orders.length) installerBuckets.push(unassigned);

    // 4b. Flat list of pending-but-undated orders for the "needs scheduling"
    //     panel. Each carries the assigned installer name(s) or "Unassigned".
    const unscheduledRows = unscheduled.map((o) => {
      const firstLine = firstLineByOrder.get(o.id);
      const names = (o.installer_ids || [])
        .map((iid) => nameOf.get(iid))
        .filter(Boolean) as string[];
      return {
        id: o.id,
        name: o.name,
        dealer_ref: o.dealer_ref || "",
        client_name: o.client_name,
        client_address: o.client_address || "",
        door_type: firstLine?.door_type ?? "",
        color: firstLine?.color ?? "",
        qty: o.door_count || 1,
        stage_code: o.stage_code,
        installer: names.length ? names.join(", ") : "Unassigned",
        installer_ids: o.installer_ids || [],
      };
    });

    // 4c. Overdue rows: scheduled in the past, still not installed. Carries
    //     daysOverdue so the UI can flag how late each one is.
    const todayMs = new Date(todayStr + "T00:00:00").getTime();
    const overdueRows = overdue.map((o) => {
      const firstLine = firstLineByOrder.get(o.id);
      const names = (o.installer_ids || [])
        .map((iid) => nameOf.get(iid))
        .filter(Boolean) as string[];
      const dateStr = o.installation_date
        ? String(o.installation_date).slice(0, 10)
        : "";
      const daysOverdue = dateStr
        ? Math.round((todayMs - new Date(dateStr + "T00:00:00").getTime()) / 86_400_000)
        : 0;
      return {
        id: o.id,
        name: o.name,
        dealer_ref: o.dealer_ref || "",
        client_name: o.client_name,
        client_address: o.client_address || "",
        door_type: firstLine?.door_type ?? "",
        qty: o.door_count || 1,
        scheduled_date: dateStr,
        days_overdue: daysOverdue,
        installer: names.length ? names.join(", ") : "Unassigned",
        installer_ids: o.installer_ids || [],
      };
    });

    // 5. Daily breakdown for the bar chart. One bar per weekday with
    //    installed / pending / not_scheduled counts.
    const days: Array<{
      date: string;
      label: string;
      installed: number;
      pending: number;
      not_scheduled: number;
    }> = [];
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dStr = ymd(d);
      const dayLabel = `${dayNames[i]} ${d.getDate()}`;
      let installed = 0;
      let pending = 0;
      for (const o of orders) {
        if (!o.installation_date) continue;
        const installDate = String(o.installation_date).slice(0, 10);
        if (installDate !== dStr) continue;
        const qty = o.door_count || 1;
        if (o.stage_code === "installed" || o.stage_code === "invoiced" || o.stage_code === "closed") {
          installed += qty;
        } else {
          pending += qty;
        }
      }
      days.push({
        date: dStr,
        label: dayLabel,
        installed,
        pending,
        not_scheduled: 0,
      });
    }

    // 6. Summary KPIs.
    const totalDoors = orders.reduce((s, o) => s + (o.door_count || 1), 0);
    const installedThisWeek = orders
      .filter((o) => ["installed", "invoiced", "closed"].includes(o.stage_code))
      .reduce((s, o) => s + (o.door_count || 1), 0);
    const pendingThisWeek = totalDoors - installedThisWeek;
    const paymentDue = installedThisWeek * INSTALLER_RATE_PER_DOOR;

    // Total installers = res.users members of the Installer / Instalador
    // group (mirrors the /api/contractors logic so the count is stable
    // even when no orders are assigned this week). We use a coarse name
    // match because the group label is i18n-dependent.
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
    }).catch(() => [] as GroupRow[]);
    const norm = (n: GroupRow["name"]) =>
      typeof n === "string" ? n : (n?.en_US ?? "");
    const installerGroupIds = groups
      .filter((g) => {
        const label = norm(g.name).toLowerCase();
        return label.includes("instalador") || label.includes("installer");
      })
      .map((g) => g.id);
    let totalInstallersCount = 0;
    if (installerGroupIds.length) {
      const totalInstallersResp = await call<Array<{ id: number }>>({
        session: s.session,
        model: "res.users",
        method: "search_read",
        args: [
          [["active", "=", true], ["groups_id", "in", installerGroupIds]],
          ["id"],
        ],
        kwargs: { limit: 100 },
      }).catch(() => [] as Array<{ id: number }>);
      totalInstallersCount = totalInstallersResp.length;
    }
    // Fallback: count whoever has an assignment this week.
    if (!totalInstallersCount) {
      totalInstallersCount = installerBuckets.filter((b) => b.id !== 0).length;
    }

    // Count of orders that are actually scheduled (have a date — they show on
    // the calendar), independent of the current week.
    const scheduledCount = await call<number>({
      session: s.session,
      model: "indigo.order",
      method: "search_count",
      args: [[["stage_code", "=", "install_scheduled"]]],
      kwargs: {},
    });

    return NextResponse.json({
      weekStart: mondayStr,
      weekEnd: sundayStr,
      ratePerDoor: INSTALLER_RATE_PER_DOOR,
      summary: {
        totalInstallers: totalInstallersCount,
        doorsToInstall: totalDoors,
        installedThisWeek,
        pendingThisWeek,
        scheduled: scheduledCount,
        paymentDue,
      },
      installers: installerBuckets,
      unscheduled: unscheduledRows,
      overdue: overdueRows,
      days,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
