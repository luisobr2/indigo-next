import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { groupOrdersByHoldCause, type HoldCause } from "@/lib/installations/hold-groups";

export const runtime = "nodejs";

const INSTALLER_RATE_PER_DOOR = 35;

// Stages the dashboard counts as "Installations Pending". Kept in sync with
// the Odoo dashboard model (PENDING_INSTALL_CODES) so the KPI on the
// dashboard reconciles with what this page can show.
const PENDING_INSTALL_CODES = ["ready_install", "install_scheduled"];

/**
 * GET /api/installers/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
 * (falls back to ?week=<Monday> or the current Mon–Sun week)
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
    // Date range for the board. Accept explicit from/to (YYYY-MM-DD); fall back
    // to ?week (its Monday) or the current week (Mon–Sun) for compatibility.
    const isYmd = (v: string | null): v is string => {
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
      // Reject impossible calendar dates (2026-13-45, 2026-02-30…) that the
      // regex alone would pass straight into the Odoo date domain -> 500.
      const d = new Date(v + "T00:00:00Z");
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    };
    const fromParam = sp.get("from");
    const toParam = sp.get("to");
    let startStr: string;
    let endStr: string;
    if (isYmd(fromParam) && isYmd(toParam)) {
      // Normalize so start <= end even if the two inputs are swapped.
      startStr = fromParam <= toParam ? fromParam : toParam;
      endStr = fromParam <= toParam ? toParam : fromParam;
    } else {
      const weekParam = sp.get("week");
      const monday = startOfWeek(weekParam ? new Date(weekParam) : new Date());
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      startStr = ymd(monday);
      endStr = ymd(sunday);
    }

    interface OrderRow {
      id: number;
      name: string;
      dealer_ref: string;
      client_name: string;
      client_phone?: string | false;
      client_address: string;
      install_distance_mi?: number;
      install_direction?: string | false;
      install_range_id?: [number, string] | false;
      install_geo_approx?: boolean;
      installer_ids: number[];
      door_count: number;
      installation_date: string | false;
      stage_code: string;
      total_sqf: number;
    }

    // 1. Pull every order with installation_date inside this week, regardless
    //    of stage (Pending, Scheduled, Installed). We grab a wider net for
    //    the "Pending" / "Not Started" buckets too.
    const ORDER_LIMIT = 2000;
    const orders = await call<OrderRow[]>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["installation_date", ">=", startStr],
          ["installation_date", "<=", endStr],
        ],
        [
          "id",
          "name",
          "dealer_ref",
          "client_name",
          "client_phone",
          "client_address",
          "installer_ids",
          "door_count",
          "installation_date",
          "stage_code",
          "total_sqf",
          // Planificacion por distancia (pedido #4 de Majela): agrupar por
          // rango y por lado para no mandar al instalador al norte y al sur
          // el mismo dia. Se calculan en Odoo desde el ZIP -- ver
          // addons/indigo_decors/models/indigo_zip_geo.py.
          "install_distance_mi",
          "install_direction",
          "install_range_id",
          "install_geo_approx",
        ],
      ],
      kwargs: { limit: ORDER_LIMIT, order: "installation_date" },
    });

    // Guard against silent under-reporting: if we hit the row cap, the KPIs and
    // lists would only reflect the earliest slice of the range. Detect it so
    // the UI can tell the user to narrow the range instead of showing a wrong
    // (partial) total with no warning.
    let truncated = false;
    let totalInRange = orders.length;
    if (orders.length >= ORDER_LIMIT) {
      totalInRange = await call<number>({
        session: s.session,
        model: "indigo.order",
        method: "search_count",
        args: [
          [
            ["installation_date", ">=", startStr],
            ["installation_date", "<=", endStr],
          ],
        ],
        kwargs: {},
      });
      truncated = totalInRange > orders.length;
    }

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
          "client_phone",
          "client_address",
          "installer_ids",
          "door_count",
          "installation_date",
          "stage_code",
          "total_sqf",
          // Planificacion por distancia (pedido #4 de Majela): agrupar por
          // rango y por lado para no mandar al instalador al norte y al sur
          // el mismo dia. Se calculan en Odoo desde el ZIP -- ver
          // addons/indigo_decors/models/indigo_zip_geo.py.
          "install_distance_mi",
          "install_direction",
          "install_range_id",
          "install_geo_approx",
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
          "client_phone",
          "client_address",
          "installer_ids",
          "door_count",
          "installation_date",
          "stage_code",
          "total_sqf",
          // Planificacion por distancia (pedido #4 de Majela): agrupar por
          // rango y por lado para no mandar al instalador al norte y al sur
          // el mismo dia. Se calculan en Odoo desde el ZIP -- ver
          // addons/indigo_decors/models/indigo_zip_geo.py.
          "install_distance_mi",
          "install_direction",
          "install_range_id",
          "install_geo_approx",
        ],
      ],
      kwargs: { limit: 500, order: "installation_date" },
    });

    // 1d. On hold — Majela's 2026-08-15 request (item 3): tell a door
    //     blocked by the DEALER apart from one blocked by the CLIENT, with
    //     a count per cause, instead of everything reading as one
    //     undifferentiated "on hold". Week-agnostic like unscheduled/
    //     overdue (a hold isn't tied to a scheduled date), and excludes
    //     'closed' orders — fully wrapped up, so a leftover on_hold flag on
    //     one no longer needs anyone's attention here.
    interface OnHoldRow extends OrderRow {
      hold_cause: HoldCause | false;
      hold_reason: string | false;
    }
    const onHold = await call<OnHoldRow[]>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["on_hold", "=", true],
          ["stage_id.code", "!=", "closed"],
        ],
        [
          "id",
          "name",
          "dealer_ref",
          "client_name",
          "client_phone",
          "client_address",
          "installer_ids",
          "door_count",
          "installation_date",
          "stage_code",
          "total_sqf",
          "hold_cause",
          "hold_reason",
        ],
      ],
      kwargs: { limit: 500, order: "write_date desc" },
    });

    // 2. Resolve installer names from res.partner (since installer_ids is
    //    a m2m to res.partner via the `installer_partner_rel` table). Read
    //    them once for the whole batch (weekly + unscheduled + overdue + on hold).
    const installerIdSet = new Set<number>();
    for (const o of [...orders, ...unscheduled, ...overdue, ...onHold]) {
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
    const orderIds = [...orders, ...unscheduled, ...overdue, ...onHold].map((o) => o.id);
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
        stage_code: string;
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
        stage_code: o.stage_code,
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

    // La geo que la pantalla necesita para agrupar por ruta. En un helper
    // porque la misma forma la consumen las filas por agendar, las vencidas
    // y las en espera, y tres copias se desincronizan.
    const geoOf = (o: {
      install_distance_mi?: number;
      install_direction?: string | false;
      install_range_id?: [number, string] | false;
      install_geo_approx?: boolean;
    }) => ({
      // Anidado bajo `geo` a proposito: son cinco campos que viajan juntos y
      // aplanarlos invita a que alguno se pierda al copiar una forma de fila.
      geo: {
        distance_mi: typeof o.install_distance_mi === "number" ? o.install_distance_mi : null,
        direction: (o.install_direction || null) as string | null,
        range_id: Array.isArray(o.install_range_id) ? o.install_range_id[0] : null,
        range_name: Array.isArray(o.install_range_id) ? o.install_range_id[1] : null,
        geo_approx: !!o.install_geo_approx,
      },
    });

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
        client_phone: o.client_phone || "",
        client_address: o.client_address || "",
        door_type: firstLine?.door_type ?? "",
        color: firstLine?.color ?? "",
        qty: o.door_count || 1,
        stage_code: o.stage_code,
        installer: names.length ? names.join(", ") : "Unassigned",
        installer_ids: o.installer_ids || [],
        ...geoOf(o),
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
        ...geoOf(o),
      };
    });

    // 4d. On-hold rows, grouped by cause (dealer / client / other) with a
    //     door count per group — the "Problema del dealer · 7 puertas"
    //     counters plus the per-cause panels on the Installations screen.
    //     groupOrdersByHoldCause is pure/unit-tested (hold-groups.test.ts);
    //     it also folds any row with a missing/unrecognized cause into
    //     'other' rather than dropping it from every count.
    const onHoldRowOf = (o: OnHoldRow) => {
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
        door_count: o.door_count || 1,
        stage_code: o.stage_code,
        hold_cause: (o.hold_cause || "other") as HoldCause,
        hold_reason: o.hold_reason || "",
        installer: names.length ? names.join(", ") : "Unassigned",
        ...geoOf(o),
      };
    };
    const onHoldGroups = groupOrdersByHoldCause(onHold);
    const onHoldPayload = {
      dealer: {
        doorCount: onHoldGroups.dealer.doorCount,
        orders: onHoldGroups.dealer.orders.map(onHoldRowOf),
      },
      client: {
        doorCount: onHoldGroups.client.doorCount,
        orders: onHoldGroups.client.orders.map(onHoldRowOf),
      },
      other: {
        doorCount: onHoldGroups.other.doorCount,
        orders: onHoldGroups.other.orders.map(onHoldRowOf),
      },
    };

    // 5. Daily breakdown for the bar chart — one bar per day across the whole
    //    range (capped so a very long range doesn't produce an unusable chart).
    const days: Array<{
      date: string;
      label: string;
      installed: number;
      pending: number;
      not_scheduled: number;
    }> = [];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MAX_DAY_BARS = 45;
    const cursor = new Date(startStr + "T00:00:00");
    const rangeEndDate = new Date(endStr + "T00:00:00");
    for (let i = 0; cursor <= rangeEndDate && i < MAX_DAY_BARS; i++) {
      const dStr = ymd(cursor);
      const dayLabel = `${dayNames[cursor.getDay()]} ${cursor.getDate()}`;
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
      days.push({ date: dStr, label: dayLabel, installed, pending, not_scheduled: 0 });
      cursor.setDate(cursor.getDate() + 1);
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
      // stage_code is a non-stored computed field; search via the stored
      // relation path (same pattern the orders API uses).
      args: [[["stage_id.code", "=", "install_scheduled"]]],
      kwargs: {},
    });

    // 4e. Resumen por rango de distancia — el panel "Zonas de instalacion".
    //
    // Se cuenta sobre lo que queda POR HACER (por agendar + vencidas + en
    // espera), no sobre todo el historico: la pregunta que responde es "que
    // tengo pendiente y de que lado me queda", no "cuanto instale este ano".
    //
    // Los rangos se leen de Odoo en vez de fijarlos aca para que Majela pueda
    // moverlos desde Config sin que haya que tocar y redesplegar el panel.
    const zoneRanges = await call<Array<{
      id: number;
      name: string;
      short_name: string | false;
      min_miles: number;
      max_miles: number;
      color: string | false;
    }>>({
      session: s.session,
      model: "indigo.install.range",
      method: "search_read",
      args: [[], ["id", "name", "short_name", "min_miles", "max_miles", "color"]],
      kwargs: { order: "sequence" },
    });

    const pendingForZones = [...unscheduled, ...overdue, ...onHold];
    const zoneStats = new Map<number | null, { doors: number; orders: number; dirs: Set<string> }>();
    for (const o of pendingForZones) {
      const key = Array.isArray(o.install_range_id) ? o.install_range_id[0] : null;
      const bucket = zoneStats.get(key) ?? { doors: 0, orders: 0, dirs: new Set<string>() };
      bucket.doors += o.door_count || 1;
      bucket.orders += 1;
      if (o.install_direction) bucket.dirs.add(o.install_direction as string);
      zoneStats.set(key, bucket);
    }

    const DIR_ORDER = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
    const zones = zoneRanges.map((r) => {
      const st = zoneStats.get(r.id);
      return {
        id: r.id,
        name: r.name,
        short_name: r.short_name || "",
        min_miles: r.min_miles,
        max_miles: r.max_miles,
        color: r.color || "#64748b",
        doors: st?.doors ?? 0,
        orders: st?.orders ?? 0,
        directions: [...(st?.dirs ?? [])].sort(
          (a, b) => DIR_ORDER.indexOf(a) - DIR_ORDER.indexOf(b),
        ),
      };
    });
    // Las que no se pudieron ubicar van como una fila mas, nunca escondidas:
    // si desaparecen, el total de la pantalla deja de cuadrar con el tablero
    // y nadie sabe por que.
    const unlocated = zoneStats.get(null);
    const zonesUnlocated = {
      doors: unlocated?.doors ?? 0,
      orders: unlocated?.orders ?? 0,
    };

    return NextResponse.json({
      rangeStart: startStr,
      rangeEnd: endStr,
      truncated,
      totalInRange,
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
      onHold: onHoldPayload,
      zones,
      zonesUnlocated,
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
