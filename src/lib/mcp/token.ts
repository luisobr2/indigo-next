/**
 * MCP bearer tokens are `<odoo_login>.<odoo_api_key>`.
 *
 * The token IS an Odoo credential pair, so verification is just an Odoo
 * authentication: the RPC then runs as that real person and Odoo's ACLs and
 * record rules apply unchanged, with no separate permission store to keep in
 * sync. Revoking access = deleting the API key in Odoo.
 */
// Lazy import to allow loading in test environments that don't resolve @/ aliases
async function getAuthenticate() {
  const { authenticate } = await import("@/lib/odoo/client");
  return authenticate;
}

export interface McpIdentity {
  uid: number;
  login: string;
  name: string;
  groups: string[];
  /** Odoo session cookie to forward on subsequent RPCs. */
  session: string;
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

export async function verifyMcpToken(header: string | null): Promise<McpIdentity | null> {
  const pair = parseBearer(header);
  if (!pair) return null;
  try {
    const authenticate = await getAuthenticate();
    const res = await authenticate(pair.login, pair.apiKey);
    return {
      uid: res.uid,
      login: res.user.login,
      name: res.user.name,
      groups: res.user.groups,
      session: res.session,
    };
  } catch {
    // Bad key, disabled user, Odoo down — all are "no identity" to the caller.
    return null;
  }
}
