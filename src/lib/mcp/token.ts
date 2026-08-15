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
// Lazy import to allow loading in test environments that don't resolve @/ aliases
async function getRpc() {
  const { rpcAuthenticate, rpcExecuteKw } = await import("@/lib/odoo/rpc");
  return { rpcAuthenticate, rpcExecuteKw };
}

export interface McpIdentity {
  uid: number;
  login: string;
  name: string;
  groups: string[];
  /** Odoo API key, forwarded on every subsequent execute_kw call. */
  apiKey: string;
}

export function parseBearer(header: string | null): { login: string; apiKey: string } | null {
  if (!header) return null;
  const raw = header.trim().replace(/^Bearer\s+/i, "").trim();
  // Split on the LAST dot: Odoo logins are emails and contain dots.
  const idx = raw.lastIndexOf(".");
  if (idx <= 0 || idx === raw.length - 1) return null;
  const login = raw.slice(0, idx);
  const apiKey = raw.slice(idx + 1);
  if (!login || !apiKey) return null;
  return { login, apiKey };
}

interface ResUsersRow {
  name: string;
  groups_id: number[];
}

interface ResGroupsRow {
  name: string;
  full_name?: string;
}

export async function verifyMcpToken(header: string | null): Promise<McpIdentity | null> {
  const pair = parseBearer(header);
  if (!pair) return null;
  try {
    const { rpcAuthenticate, rpcExecuteKw } = await getRpc();
    const uid = await rpcAuthenticate(pair.login, pair.apiKey);
    if (!uid) return null;

    const userRows = await rpcExecuteKw<ResUsersRow[]>(
      uid,
      pair.apiKey,
      "res.users",
      "read",
      [[uid], ["name", "groups_id"]],
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

    return {
      uid,
      login: pair.login,
      name: user.name,
      groups,
      apiKey: pair.apiKey,
    };
  } catch {
    // Bad key, disabled user, Odoo down — all are "no identity" to the caller.
    return null;
  }
}
