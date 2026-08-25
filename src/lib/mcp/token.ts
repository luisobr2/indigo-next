/**
 * MCP bearer tokens are `<odoo_login>.<odoo_api_key>`.
 *
 * The token IS an Odoo credential pair, so verification is just an Odoo
 * authentication: the RPC then runs as that real person and Odoo's ACLs and
 * record rules apply unchanged, with no separate permission store to keep in
 * sync. Revoking access = deleting the API key in Odoo.
 *
 * Unlike the panel's own login (src/lib/odoo/client.ts, session-cookie
 * based, real password only), MCP tokens are verified against Odoo's
 * external API (src/lib/odoo/rpc.ts, `/jsonrpc`), which is the endpoint
 * that actually accepts an API key. There is no session cookie in this
 * flow — every subsequent tool call re-authenticates with the same
 * uid + apiKey pair via `execute_kw`.
 */
import { OAUTH_TOKEN_PREFIX, readAccessToken } from "./oauth.ts";

// Lazy import to allow loading in test environments that don't resolve @/ aliases
async function getRpc() {
  const { rpcAuthenticate, rpcExecuteKw } = await import("@/lib/odoo/rpc");
  return { rpcAuthenticate, rpcExecuteKw };
}

export interface McpIdentity {
  uid: number;
  login: string;
  groups: string[];
  /** Odoo API key, forwarded on every subsequent execute_kw call. */
  apiKey: string;
  /** Mirrors Odoo's `res.users._is_admin()` — membership in
   *  `base.group_system`. Every stage wizard in the addon short-circuits
   *  its role check on `user._is_admin()`, so the MCP's own pre-write
   *  authorization (assertMayAdvance in ./tools.ts) has to honour the same
   *  bypass or it would refuse work Odoo itself would allow. Resolved by
   *  GROUP ID, not by name: `full_name` is "<Category> / <Group>" and both
   *  halves are translatable (this deployment loads es_ES and en_US), so
   *  string-matching "Administration / Settings" would silently stop
   *  matching the day someone flips the admin's language. */
  isAdmin: boolean;
}

/**
 * The exact `res.groups.full_name` for `base.group_user` ("Access Rights"
 * technically, but Odoo's own category for it is "User types") in this
 * deployment — verified live against indigo-prod rather than assumed, since
 * full_name is "<Category> / <Group>" and the category naming isn't
 * documented anywhere stable. This surface is for the internal team only;
 * dealers authenticate as portal users in this deployment and must never
 * carry this group.
 */
const INTERNAL_USER_GROUP = "User types / Internal User";

/** True if this identity is an internal Odoo user (not a portal/dealer login). */
export function isInternalUser(groups: string[]): boolean {
  return groups.includes(INTERNAL_USER_GROUP);
}

/**
 * Convierte el header en el par login+clave con el que se llama a Odoo.
 *
 * Acepta las dos formas que puede tener un bearer aqui:
 *
 *   1. `<login>.<claveApi>` — la historica, la que se pega a mano.
 *   2. `imcp_access.…` — un access token de OAuth, que lleva ese mismo par
 *      cifrado dentro (ver ./oauth.ts).
 *
 * Que la traduccion viva aqui es lo que hace que OAuth no toque nada mas: de
 * esta funcion para abajo —verifyMcpToken, las 13 herramientas, las ACL de
 * Odoo— todo sigue viendo exactamente lo mismo que antes.
 *
 * El orden importa: primero se prueba OAuth. Un token de OAuth tambien tiene
 * puntos, asi que si se partiera antes por el ultimo punto saldria un par
 * absurdo que Odoo rechazaria, y el resultado seria un 401 en vez de una
 * sesion valida.
 */
export function parseBearer(header: string | null): { login: string; apiKey: string } | null {
  if (!header) return null;
  const raw = header.trim().replace(/^Bearer\s+/i, "").trim();

  if (raw.startsWith(OAUTH_TOKEN_PREFIX)) {
    // Solo un access token. Un refresh token presentado aqui no vale: es
    // credencial del endpoint /token, no del MCP, y readAccessToken lo
    // rechaza por proposito.
    return readAccessToken(raw, Date.now());
  }

  // Split on the LAST dot: Odoo logins are emails and contain dots.
  const idx = raw.lastIndexOf(".");
  if (idx <= 0 || idx === raw.length - 1) return null;
  const login = raw.slice(0, idx);
  const apiKey = raw.slice(idx + 1);
  if (!login || !apiKey) return null;
  return { login, apiKey };
}

interface ResUsersRow {
  groups_id: number[];
}

interface ResGroupsRow {
  name: string;
  full_name?: string;
}

/**
 * The numeric id of `base.group_system`, resolved once per process and
 * cached: xmlid -> id never changes for a given database, and this would
 * otherwise be an extra RPC on the hot path of every single MCP request.
 *
 * Read through `ir.model.data`, which Odoo grants read on to every
 * authenticated user, so this works with the caller's own credentials and
 * needs no elevated access. A failure (or a database where the record
 * somehow doesn't exist) yields `null`, which callers must read as "not an
 * admin" — erring toward the stricter answer, never toward granting a
 * bypass we couldn't verify.
 */
let adminGroupIdPromise: Promise<number | null> | null = null;

async function resolveAdminGroupId(uid: number, apiKey: string): Promise<number | null> {
  if (!adminGroupIdPromise) {
    adminGroupIdPromise = (async () => {
      const { rpcExecuteKw } = await getRpc();
      const rows = await rpcExecuteKw<Array<{ res_id: number }>>(
        uid,
        apiKey,
        "ir.model.data",
        "search_read",
        [
          [
            ["module", "=", "base"],
            ["name", "=", "group_system"],
          ],
          ["res_id"],
        ],
        { limit: 1 },
      );
      return rows[0]?.res_id ?? null;
    })().catch(() => {
      // Don't cache a failure: a transient RPC error here would otherwise
      // pin every later request in this process to "not an admin".
      adminGroupIdPromise = null;
      return null;
    });
  }
  return adminGroupIdPromise;
}

/**
 * A thrown OdooRpcError is "transient" — worth a 503 rather than a 401 —
 * when it never got a real answer from Odoo at all: our own timeout, a
 * network-level failure, or Odoo itself erroring at the HTTP level (5xx).
 * A bad login/API key never throws here (`common.authenticate` returns
 * `false`, see rpcAuthenticate) so anything else thrown is either this, or
 * a genuinely unexpected Odoo-side error we still don't want to mislabel
 * as "bad token" — see verifyMcpToken below for how each branch is used.
 * Duck-typed on `.name`/`.errorName`/`.httpStatus` (set by rpc.ts's
 * OdooRpcError) instead of `instanceof` so this module doesn't need a
 * top-level, always-evaluated import of rpc.ts just for a class reference.
 */
function isTransientOdooError(e: unknown): boolean {
  if (!(e instanceof Error) || e.name !== "OdooRpcError") return false;
  const err = e as Error & { errorName?: string; httpStatus?: number };
  if (err.errorName === "TIMEOUT" || err.errorName === "NETWORK") return true;
  return typeof err.httpStatus === "number" && err.httpStatus >= 500;
}

/**
 * Verifies an MCP bearer token against Odoo and returns the caller's
 * identity, or `null` if the credentials are genuinely invalid (bad key,
 * disabled user, deleted user). Errs closed on ambiguity: `null` becomes an
 * HTTP 401 in the route.
 *
 * Deliberately does NOT swallow a transient failure (Odoo down, timeout,
 * connection refused) into that same `null` — those are rethrown so the
 * route can answer 503 instead of telling someone their token is invalid
 * during an Odoo restart. See isTransientOdooError above.
 */
export async function verifyMcpToken(header: string | null): Promise<McpIdentity | null> {
  const pair = parseBearer(header);
  if (!pair) return null;
  const { rpcAuthenticate, rpcExecuteKw } = await getRpc();

  let uid: number | null;
  try {
    uid = await rpcAuthenticate(pair.login, pair.apiKey);
  } catch (e) {
    if (isTransientOdooError(e)) throw e;
    return null;
  }
  if (!uid) return null;

  try {
    const userRows = await rpcExecuteKw<ResUsersRow[]>(
      uid,
      pair.apiKey,
      "res.users",
      "read",
      [[uid], ["groups_id"]],
      {},
    );
    const user = userRows[0];
    if (!user) return null;

    const groupIds = user.groups_id ?? [];
    let groups: string[] = [];
    if (groupIds.length) {
      const groupRows = await rpcExecuteKw<ResGroupsRow[]>(
        uid,
        pair.apiKey,
        "res.groups",
        "read",
        [groupIds, ["name", "full_name"]],
        {},
      );
      groups = groupRows.map((g) => g.full_name ?? g.name);
    }

    const adminGroupId = await resolveAdminGroupId(uid, pair.apiKey);

    return {
      uid,
      login: pair.login,
      groups,
      isAdmin: adminGroupId !== null && groupIds.includes(adminGroupId),
      apiKey: pair.apiKey,
    };
  } catch (e) {
    if (isTransientOdooError(e)) throw e;
    // Disabled/deleted user between authenticate and this read, or any
    // other unexpected Odoo error reading identity — still "no identity".
    return null;
  }
}
