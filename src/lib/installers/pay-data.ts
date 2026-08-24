import { call } from "@/lib/odoo/client";
import { dayAmount, resolveRule, type PayRule } from "@/lib/pay-rules";

export const runtime = "nodejs";

/**
 * Assembles what an installer earned, day by day, for a date range.
 *
 * Lives in a lib and not in the route because TWO surfaces need exactly
 * this shape -- the JSON the page reads and the Excel export -- and two
 * copies of a money calculation is how they drift apart.
 *
 * One row per installer per DAY — the unit an installer is actually paid in.
 *
 * Two sources, deliberately:
 *   - A day already worked has a payout. Odoo computed it under that
 *     person's rule and wrote the adjustment down as a line; those amounts
 *     are what somebody will be handed, so they are read, never re-derived.
 *   - A day still scheduled has no payout, because nothing has been earned.
 *     Those are projected with the same formula from the same rules
 *     (src/lib/pay-rules.ts) and marked `scheduled`, so nobody mistakes a
 *     plan for a debt.
 *
 * `workMode` is derived, never stored: it names WHICH branch of the rule
 * decided the day — the per-door rate, a flat day rate, or the floor topping
 * a thin day up. That is the one thing a person looking at a payment
 * actually wants explained.
 */

const isYmd = (v: string | null): v is string => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}

export type WorkMode = "per_door" | "daily" | "guarantee";

interface PayoutRow {
  id: number;
  name: string;
  contractor_id: [number, string] | false;
  work_date: string | false;
  amount: number;
  state: "draft" | "approved" | "paid" | "cancel";
}

interface LineRow {
  id: number;
  payout_id: [number, string] | false;
  order_id: [number, string] | false;
  line_kind: "work" | "minimum" | "bonus";
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

interface RateRow {
  id: number;
  partner_id: [number, string] | false;
  rate: number;
  daily_minimum: number;
  bonus_amount: number;
  bonus_unit: "order" | "door";
}

interface OrderRow {
  id: number;
  name: string;
  client_name: string;
  notes: string | false;
  door_count: number;
  installation_date: string | false;
  installer_ids: number[];
  stage_code: string;
  incidence: boolean;
}

interface IncidentRow {
  id: number;
  order_id: [number, string] | false;
  user_id: [number, string] | false;
  date: string;
  category: string;
  description: string;
}

/** Stages whose work is agreed but not done — no payout exists yet. */
const SCHEDULED_CODES = ["ready_install", "install_scheduled"];

/** Caps. `from`/`to` come off the query string, so nothing stops a caller
 *  asking for two years. Every limit below is reported back as `truncated`
 *  rather than silently dropping rows: this page adds up money, and a total
 *  that quietly omitted half the week is worse than no total. */
export const MAX_RANGE_DAYS = 92;
const PAYOUT_LIMIT = 500;
const LINE_LIMIT = 3000;
const ORDER_LIMIT = 500;
const INCIDENT_LIMIT = 200;

/** Week (Mon-Sun) by default; an explicit from/to wins and is normalised. */
export function resolveRange(
  fromParam: string | null,
  toParam: string | null,
  weekParam: string | null,
): { startStr: string; endStr: string } {
  if (isYmd(fromParam) && isYmd(toParam)) {
    return fromParam <= toParam
      ? { startStr: fromParam, endStr: toParam }
      : { startStr: toParam, endStr: fromParam };
  }
  const monday = startOfWeek(weekParam ? new Date(weekParam) : new Date());
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { startStr: ymd(monday), endStr: ymd(sunday) };
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export interface PayDataArgs {
  session: string;
  startStr: string;
  endStr: string;
}

export async function buildPayData({ session: s0, startStr, endStr }: PayDataArgs) {
  const s = { session: s0 };
  const [payouts, rateRows, scheduled] = await Promise.all([
    call<PayoutRow[]>({
      session: s.session,
      model: "indigo.payout",
      method: "search_read",
      args: [
        [
          ["contractor_type", "=", "installer"],
          ["state", "!=", "cancel"],
          ["work_date", ">=", startStr],
          ["work_date", "<=", endStr],
        ],
        ["id", "name", "contractor_id", "work_date", "amount", "state"],
      ],
      kwargs: { order: "work_date asc, id asc", limit: PAYOUT_LIMIT },
    }),
    call<RateRow[]>({
      session: s.session,
      model: "indigo.contractor.rate",
      method: "search_read",
      args: [
        [["contractor_type", "=", "installer"], ["active", "=", true]],
        ["id", "partner_id", "rate", "daily_minimum", "bonus_amount", "bonus_unit"],
      ],
      kwargs: { limit: 100 },
    }),
    call<OrderRow[]>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["installation_date", ">=", startStr],
          ["installation_date", "<=", endStr],
          ["stage_code", "in", SCHEDULED_CODES],
        ],
        ["id", "name", "client_name", "notes", "door_count", "installation_date", "installer_ids", "stage_code", "incidence"],
      ],
      kwargs: { limit: ORDER_LIMIT },
    }),
  ]);

  const payoutIds = payouts.map((p) => p.id);
  const lines = payoutIds.length
    ? await call<LineRow[]>({
        session: s.session,
        model: "indigo.payout.line",
        method: "search_read",
        args: [
          [["payout_id", "in", payoutIds]],
          ["id", "payout_id", "order_id", "line_kind", "description", "quantity", "rate", "amount"],
        ],
        kwargs: { order: "line_kind, id", limit: LINE_LIMIT },
      })
    : [];

  // Orders behind the worked days — for their notes and incident flag.
  const workedOrderIds = [
    ...new Set(
      lines
        .filter((l) => l.line_kind === "work" && Array.isArray(l.order_id))
        .map((l) => (l.order_id as [number, string])[0]),
    ),
  ];
  const [workedOrders, incidents] = await Promise.all([
    workedOrderIds.length
      ? call<OrderRow[]>({
          session: s.session,
          model: "indigo.order",
          method: "search_read",
          args: [
            [["id", "in", workedOrderIds]],
            ["id", "name", "client_name", "notes", "door_count", "installation_date", "installer_ids", "stage_code", "incidence"],
          ],
          kwargs: { limit: 500 },
        })
      : Promise.resolve([] as OrderRow[]),
    call<IncidentRow[]>({
      session: s.session,
      model: "indigo.order.incident",
      method: "search_read",
      args: [
        [
          ["date", ">=", `${startStr} 00:00:00`],
          ["date", "<=", `${endStr} 23:59:59`],
        ],
        ["id", "order_id", "user_id", "date", "category", "description"],
      ],
      kwargs: { order: "date desc", limit: INCIDENT_LIMIT },
    }),
  ]);

  const orderById = new Map<number, OrderRow>();
  for (const o of [...workedOrders, ...scheduled]) orderById.set(o.id, o);

  const payRules: PayRule[] = rateRows.map((r) => ({
    partnerId: Array.isArray(r.partner_id) ? r.partner_id[0] : null,
    ratePerDoor: r.rate,
    dailyMinimum: r.daily_minimum,
    bonusAmount: r.bonus_amount,
    bonusUnit: r.bonus_unit,
  }));

  const incidentsByOrder = new Map<number, IncidentRow[]>();
  for (const i of incidents) {
    if (!Array.isArray(i.order_id)) continue;
    const arr = incidentsByOrder.get(i.order_id[0]) ?? [];
    arr.push(i);
    incidentsByOrder.set(i.order_id[0], arr);
  }

  const linesByPayout = new Map<number, LineRow[]>();
  for (const l of lines) {
    if (!Array.isArray(l.payout_id)) continue;
    const arr = linesByPayout.get(l.payout_id[0]) ?? [];
    arr.push(l);
    linesByPayout.set(l.payout_id[0], arr);
  }

  /** First meaningful line of an order's note log, for the table's Notes cell. */
  const firstNote = (o: OrderRow | undefined): string | null => {
    if (!o || !o.notes) return null;
    const line = String(o.notes).split("\n").map((x) => x.trim()).find(Boolean);
    return line ? (line.length > 80 ? `${line.slice(0, 79)}…` : line) : null;
  };

  interface Day {
    key: string;
    date: string;
    status: "completed" | "scheduled";
    doors: number;
    installs: number;
    amount: number;
    workMode: WorkMode;
    payoutId: number | null;
    payoutName: string | null;
    payoutState: PayoutRow["state"] | null;
    orders: Array<{ id: number; name: string; client: string }>;
    notes: string[];
    incidents: number;
    /** The lines behind the amount — the breakdown of a paid day. */
    lines: Array<{ kind: LineRow["line_kind"]; description: string; quantity: number; rate: number; amount: number }>;
  }

  interface Bucket {
    installerId: number;
    name: string;
    rule: PayRule | null;
    days: Day[];
    doors: number;
    installs: number;
    total: number;
    pending: number;
    settled: number;
    scheduledAmount: number;
    daysAtMinimum: number;
    incidents: number;
  }

  const buckets = new Map<number, Bucket>();
  const bucketFor = (id: number, name: string): Bucket => {
    let b = buckets.get(id);
    if (!b) {
      b = {
        installerId: id,
        name,
        rule: resolveRule(payRules, id),
        days: [],
        doors: 0,
        installs: 0,
        total: 0,
        pending: 0,
        settled: 0,
        scheduledAmount: 0,
        daysAtMinimum: 0,
        incidents: 0,
      };
      buckets.set(id, b);
    }
    return b;
  };

  // ---- Days already worked, from the payouts ----
  for (const p of payouts) {
    if (!Array.isArray(p.contractor_id) || !p.work_date) continue;
    const b = bucketFor(p.contractor_id[0], p.contractor_id[1]);
    const pl = linesByPayout.get(p.id) ?? [];
    const work = pl.filter((l) => l.line_kind === "work");
    const doors = work.reduce((a, l) => a + (l.quantity || 0), 0);
    const perDoorTotal = work.reduce((a, l) => a + (l.amount || 0), 0);
    const orderIds = [
      ...new Set(work.filter((l) => Array.isArray(l.order_id)).map((l) => (l.order_id as [number, string])[0])),
    ];
    const installs = orderIds.length + work.filter((l) => !Array.isArray(l.order_id)).length;
    const hasFloor = pl.some((l) => l.line_kind === "minimum");

    // Which branch of the rule decided this day.
    const workMode: WorkMode = !hasFloor
      ? "per_door"
      : perDoorTotal <= 0.005
        ? "daily"       // never charges per door — the floor IS the day rate
        : "guarantee";  // the doors fell short and the floor topped it up

    const dayIncidents = orderIds.reduce((a, id) => a + (incidentsByOrder.get(id)?.length ?? 0), 0);
    b.days.push({
      key: `p${p.id}`,
      date: p.work_date,
      status: "completed",
      doors,
      installs,
      amount: p.amount,
      workMode,
      payoutId: p.id,
      payoutName: p.name,
      payoutState: p.state,
      orders: orderIds.map((id) => ({
        id,
        name: orderById.get(id)?.name ?? `#${id}`,
        client: orderById.get(id)?.client_name ?? "",
      })),
      notes: orderIds.map((id) => firstNote(orderById.get(id))).filter((n): n is string => !!n),
      incidents: dayIncidents,
      lines: pl.map((l) => ({
        kind: l.line_kind,
        description: l.description,
        quantity: l.quantity,
        rate: l.rate,
        amount: l.amount,
      })),
    });
    b.doors += doors;
    b.installs += installs;
    b.total += p.amount;
    if (p.state === "paid") b.settled += p.amount;
    else b.pending += p.amount;
    if (hasFloor) b.daysAtMinimum += 1;
    b.incidents += dayIncidents;
  }

  // ---- Days still scheduled: projected, never counted as owed ----
  const scheduledByInstallerDay = new Map<string, { installerId: number; date: string; orders: OrderRow[]; doors: number }>();
  for (const o of scheduled) {
    if (!o.installation_date) continue;
    // id 0 = nadie asignado. Sin esto el bucle no itera y el dia
    // desaparece de la pantalla -- justo el trabajo que hay que
    // accionar es el que quedaria invisible.
    const targets = (o.installer_ids ?? []).length ? o.installer_ids : [0];
    for (const iid of targets) {
      const key = `${iid}|${o.installation_date}`;
      const e = scheduledByInstallerDay.get(key) ?? {
        installerId: iid,
        date: o.installation_date as string,
        orders: [],
        doors: 0,
      };
      e.orders.push(o);
      // Shared order: each installer carries their share of the doors,
      // same split Odoo uses when it emits the payout.
      e.doors += (o.door_count || 1) / Math.max(o.installer_ids.length, 1);
      // (con 0 instaladores el divisor es 1: las puertas van enteras al
      //  cajon de "sin asignar")
      scheduledByInstallerDay.set(key, e);
    }
  }

  // Names for installers who only appear on scheduled work this week.
  const unknownIds = [...scheduledByInstallerDay.values()]
    .map((e) => e.installerId)
    .filter((id) => id !== 0 && !buckets.has(id));
  const names = unknownIds.length
    ? await call<Array<{ id: number; name: string }>>({
        session: s.session,
        model: "res.partner",
        method: "read",
        args: [[...new Set(unknownIds)], ["id", "name"]],
        kwargs: {},
      })
    : [];
  const nameById = new Map(names.map((n) => [n.id, n.name]));

  for (const e of scheduledByInstallerDay.values()) {
    const b = bucketFor(
      e.installerId,
      e.installerId === 0 ? "Nobody assigned" : (nameById.get(e.installerId) ?? "(unknown)"),
    );
    const installs = e.orders.length;
    const projected = e.installerId === 0
      ? 0 // no hay a quien pagarle todavia; el dia esta ahi para asignarlo
      : (dayAmount(b.rule, { doors: e.doors, installs }) ?? 0);
    const perDoorTotal = (b.rule?.ratePerDoor ?? 0) * e.doors;
    const floor = b.rule?.dailyMinimum ?? 0;
    const workMode: WorkMode =
      perDoorTotal <= 0.005 && floor > 0
        ? "daily"
        : perDoorTotal < floor
          ? "guarantee"
          : "per_door";
    const dayIncidents = e.orders.reduce((a, o) => a + (incidentsByOrder.get(o.id)?.length ?? 0), 0);

    b.days.push({
      key: `s${e.installerId}-${e.date}`,
      date: e.date,
      status: "scheduled",
      doors: e.doors,
      installs,
      amount: projected,
      workMode,
      payoutId: null,
      payoutName: null,
      payoutState: null,
      orders: e.orders.map((o) => ({ id: o.id, name: o.name, client: o.client_name })),
      notes: e.orders.map((o) => firstNote(o)).filter((n): n is string => !!n),
      incidents: dayIncidents,
      lines: [],
    });
    b.doors += e.doors;
    b.installs += installs;
    b.scheduledAmount += projected;
    b.incidents += dayIncidents;
  }

  for (const b of buckets.values()) b.days.sort((x, y) => x.date.localeCompare(y.date));
  const installers = [...buckets.values()].sort((a, b) => a.name.localeCompare(b.name));

  // Doors by which branch of the rule paid for them — the mockup's donut.
  const byMode: Record<WorkMode, number> = { per_door: 0, daily: 0, guarantee: 0 };
  for (const b of installers) {
    for (const d of b.days) byMode[d.workMode] += d.doors;
  }

  // Cuando la semana no tiene nada, la pantalla necesita poder decir
  // "pero hay actividad hasta el X" en vez de dejar al usuario mirando
  // ceros sin saber si el sistema fallo o si de verdad no se trabajo.
  const lastSeen = await call<Array<{ work_date: string | false }>>({
    session: s.session,
    model: "indigo.payout",
    method: "search_read",
    args: [
      [["contractor_type", "=", "installer"], ["state", "!=", "cancel"], ["work_date", "!=", false]],
      ["work_date"],
    ],
    kwargs: { order: "work_date desc", limit: 1 },
  });

  const truncated =
    payouts.length >= PAYOUT_LIMIT ||
    lines.length >= LINE_LIMIT ||
    scheduled.length >= ORDER_LIMIT ||
    incidents.length >= INCIDENT_LIMIT;

  const summary = {
    installers: installers.filter((b) => b.installerId !== 0).length,
    daysWorked: installers.reduce((a, i) => a + i.days.filter((d) => d.status === "completed").length, 0),
    daysScheduled: installers.reduce((a, i) => a + i.days.filter((d) => d.status === "scheduled").length, 0),
    doors: installers.reduce((a, i) => a + i.doors, 0),
    doorsInstalled: installers.reduce(
      (a, i) => a + i.days.filter((d) => d.status === "completed").reduce((x, d) => x + d.doors, 0),
      0,
    ),
    total: installers.reduce((a, i) => a + i.total, 0),
    pending: installers.reduce((a, i) => a + i.pending, 0),
    settled: installers.reduce((a, i) => a + i.settled, 0),
    scheduledAmount: installers.reduce((a, i) => a + i.scheduledAmount, 0),
    daysAtMinimum: installers.reduce((a, i) => a + i.daysAtMinimum, 0),
    incidents: incidents.length,
    byMode,
  };

  return {
    rangeStart: startStr,
    rangeEnd: endStr,
    // Si esto viene true, los totales de arriba estan incompletos y la
    // pantalla tiene que decirlo: son numeros de plata.
    truncated,
    lastActivityDate: lastSeen[0]?.work_date || null,
    rules: rateRows.map((r) => ({
      partnerId: Array.isArray(r.partner_id) ? r.partner_id[0] : null,
      partnerName: Array.isArray(r.partner_id) ? r.partner_id[1] : null,
      ratePerDoor: r.rate,
      dailyMinimum: r.daily_minimum,
      bonusAmount: r.bonus_amount,
      bonusUnit: r.bonus_unit,
    })),
    summary,
    installers: installers.map((b) => ({
      ...b,
      rule: b.rule
        ? {
            ratePerDoor: b.rule.ratePerDoor,
            dailyMinimum: b.rule.dailyMinimum,
            bonusAmount: b.rule.bonusAmount,
            bonusUnit: b.rule.bonusUnit,
            isOwn: b.rule.partnerId === b.installerId,
          }
        : null,
    })),
    incidents: incidents.map((i) => ({
      id: i.id,
      date: i.date,
      order: Array.isArray(i.order_id) ? i.order_id[1] : null,
      orderId: Array.isArray(i.order_id) ? i.order_id[0] : null,
      client: Array.isArray(i.order_id) ? (orderById.get(i.order_id[0])?.client_name ?? null) : null,
      reportedBy: Array.isArray(i.user_id) ? i.user_id[1] : null,
      category: i.category,
      description: i.description,
    })),
  };
}
