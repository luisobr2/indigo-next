import { NextRequest, NextResponse } from "next/server";
import { authenticate, call } from "@/lib/odoo/client";

export const runtime = "nodejs";

/**
 * GET /api/calendar.ics?token=...
 *
 * Public (token-gated) iCalendar feed of installations. Designed to be
 * SUBSCRIBED from Google/Apple Calendar ("Add calendar from URL") so the
 * team's own calendar shows every scheduled installation and fires native
 * reminders — exactly the "vincularlo con el calendario nuestro para que
 * nos avise" ask.
 *
 * No user session: calendar clients (incl. Google's servers) can't carry
 * cookies, so the feed authenticates to Odoo with a service login and is
 * protected by an unguessable token in the URL (a capability URL — the
 * URL itself is the secret, like every other .ics subscription).
 */
const ICS_TOKEN = process.env.CALENDAR_ICS_TOKEN ?? "idg-cal-2f8a91c47e6b5d30";
const SERVICE_LOGIN =
  process.env.ICS_SERVICE_LOGIN ?? "majela@indigodecors.com";
const SERVICE_PASSWORD = process.env.IMPERSONATE_PASSWORD ?? "indigo123";

const DONE_CODES = ["installed", "invoiced_paid", "invoiced", "closed"];

function localYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function icsDate(ymd: string): string {
  // YYYY-MM-DD -> YYYYMMDD (all-day VALUE=DATE).
  return ymd.slice(0, 10).replace(/-/g, "");
}

function icsDatePlusOne(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

interface OrderRow {
  id: number;
  name: string;
  dealer_ref: string | false;
  client_name: string;
  client_address: string | false;
  client_phone: string | false;
  installation_date: string | false;
  door_count: number;
  stage_code: string;
  installer_ids: number[];
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!ICS_TOKEN || token !== ICS_TOKEN) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const auth = await authenticate(SERVICE_LOGIN, SERVICE_PASSWORD);

    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 90);
    const to = new Date(now);
    to.setDate(to.getDate() + 365);

    const rows = await call<OrderRow[]>({
      session: auth.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["installation_date", ">=", localYmd(from)],
          ["installation_date", "<=", localYmd(to)],
        ],
        [
          "id",
          "name",
          "dealer_ref",
          "client_name",
          "client_address",
          "client_phone",
          "installation_date",
          "door_count",
          "stage_code",
          "installer_ids",
        ],
      ],
      kwargs: { limit: 1000, order: "installation_date" },
    });

    // Resolve installer names in one batch.
    const ids = new Set<number>();
    for (const r of rows) for (const i of r.installer_ids || []) ids.add(i);
    const partners = ids.size
      ? await call<Array<{ id: number; name: string }>>({
          session: auth.session,
          model: "res.partner",
          method: "read",
          args: [Array.from(ids), ["id", "name"]],
          kwargs: {},
        })
      : [];
    const nameOf = new Map(partners.map((p) => [p.id, p.name]));

    const stamp =
      now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Indigo Decors//Installations//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Indigo Installations",
      "X-WR-TIMEZONE:America/New_York",
    ];

    for (const o of rows) {
      if (!o.installation_date) continue;
      const date = String(o.installation_date).slice(0, 10);
      const installers = (o.installer_ids || [])
        .map((i) => nameOf.get(i))
        .filter(Boolean)
        .join(", ");
      const ref = o.dealer_ref || o.name;
      const doors = o.door_count || 1;
      const summary = `Install: ${o.client_name} (${doors}d) — ${ref}`;
      const desc = [
        `Order ${o.name}`,
        o.dealer_ref ? `Ref ${o.dealer_ref}` : "",
        `Doors: ${doors}`,
        installers ? `Installer: ${installers}` : "Installer: unassigned",
        o.client_phone ? `Phone: ${o.client_phone}` : "",
      ]
        // Real newlines; esc() turns them into the ICS "\n" escape. (Joining
        // with a literal "\\n" would double-escape and show as text.)
        .filter(Boolean)
        .join("\n");
      const done = DONE_CODES.includes(o.stage_code);

      lines.push(
        "BEGIN:VEVENT",
        `UID:indigo-order-${o.id}@indigodecors`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(date)}`,
        `DTEND;VALUE=DATE:${icsDatePlusOne(date)}`,
        `SUMMARY:${esc(summary)}`,
        `LOCATION:${esc(o.client_address)}`,
        `DESCRIPTION:${esc(desc)}`,
        `STATUS:${done ? "CONFIRMED" : "TENTATIVE"}`,
      );
      // Reminder the day before, only for installs still to be done.
      if (!done) {
        lines.push(
          "BEGIN:VALARM",
          "TRIGGER:-P1D",
          "ACTION:DISPLAY",
          "DESCRIPTION:Installation tomorrow — Indigo Decors",
          "END:VALARM",
        );
      }
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");
    const body = lines.join("\r\n");

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="indigo-installations.ics"',
        "Cache-Control": "public, max-age=900",
      },
    });
  } catch (e) {
    return new NextResponse(
      `Error: ${e instanceof Error ? e.message : "unknown"}`,
      { status: 500 },
    );
  }
}
