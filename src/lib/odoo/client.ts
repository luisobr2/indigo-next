/**
 * Odoo JSON-RPC client. All Next.js BFF routes go through this.
 *
 * Two call shapes:
 *  - `authenticate({ login, password })` -> returns a session cookie string
 *    that subsequent calls must forward back to Odoo.
 *  - `call({ session, model, method, args, kwargs })` -> wraps the
 *    standard `/web/dataset/call_kw` endpoint with the user's session.
 *
 * Why we forward the cookie verbatim instead of storing uid+token:
 *  - The user's record-rule filtering kicks in automatically (Mario only
 *    sees orders in painting), no need to plumb permissions client-side.
 *  - Logout invalidates both ends.
 */
const ODOO_URL = process.env.ODOO_URL ?? "http://localhost:8069";
const ODOO_DB = process.env.ODOO_DB ?? "indigo-prod";
const TIMEOUT_MS = parseInt(process.env.ODOO_TIMEOUT_MS ?? "30000", 10);

export class OdooError extends Error {
  constructor(message: string, public code?: string, public data?: unknown) {
    super(message);
    this.name = "OdooError";
  }
}

interface CallOptions {
  session?: string | null;
  model: string;
  method: string;
  args?: unknown[];
  kwargs?: Record<string, unknown>;
}

interface AuthResult {
  uid: number;
  session: string;
  user: {
    id: number;
    login: string;
    name: string;
    partnerId: number;
    isAdmin: boolean;
    groups: string[];
  };
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: { name?: string; message?: string; debug?: string };
  };
}

let rpcId = 0;

async function rpc<T>(
  url: string,
  body: Record<string, unknown>,
  session?: string | null,
): Promise<{ result: T; cookies: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session) headers["Cookie"] = `session_id=${session}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, ...body }),
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new OdooError(`HTTP ${res.status} from Odoo`, String(res.status));
  }

  const json = (await res.json()) as JsonRpcResponse<T>;
  if (json.error) {
    const msg =
      json.error.data?.message ?? json.error.message ?? "Odoo RPC error";
    throw new OdooError(msg, json.error.data?.name, json.error.data);
  }

  // Pull `session_id=...` cookie from Set-Cookie if present.
  const setCookies = res.headers.getSetCookie?.() ?? [];

  return { result: json.result as T, cookies: setCookies };
}

function extractSessionFromCookies(cookies: string[]): string | null {
  for (const c of cookies) {
    const m = c.match(/^session_id=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

export async function authenticate(
  login: string,
  password: string,
): Promise<AuthResult> {
  const { result, cookies } = await rpc<{
    uid: number;
    name: string;
    partner_id: number;
    user_companies?: unknown;
    server_version_info?: unknown;
    is_admin?: boolean;
    user_context?: unknown;
  } | false>(`${ODOO_URL}/web/session/authenticate`, {
    params: { db: ODOO_DB, login, password },
  });

  if (!result || !result.uid) {
    throw new OdooError("Invalid credentials", "AUTH_FAILED");
  }

  const session = extractSessionFromCookies(cookies);
  if (!session) {
    throw new OdooError("Odoo returned no session cookie", "NO_SESSION");
  }

  // Pull groups via a follow-up call so the UI can role-gate menus.
  const groups = await call<string[]>({
    session,
    model: "res.users",
    method: "read",
    args: [[result.uid], ["groups_id"]],
    kwargs: {},
  })
    .then(async (rows) => {
      const groupIds = (rows[0] as unknown as { groups_id: number[] })
        ?.groups_id ?? [];
      if (!groupIds.length) return [];
      const groupRows = await call<Array<{ name: string }>>({
        session,
        model: "res.groups",
        method: "read",
        args: [groupIds, ["name", "full_name"]],
        kwargs: {},
      });
      return groupRows.map(
        (g) => (g as unknown as { full_name?: string; name: string }).full_name ?? g.name,
      );
    })
    .catch(() => [] as string[]);

  return {
    uid: result.uid,
    session,
    user: {
      id: result.uid,
      login,
      name: result.name,
      partnerId: result.partner_id,
      isAdmin: !!result.is_admin,
      groups,
    },
  };
}

export async function call<T = unknown>({
  session,
  model,
  method,
  args = [],
  kwargs = {},
}: CallOptions): Promise<T> {
  const { result } = await rpc<T>(
    `${ODOO_URL}/web/dataset/call_kw/${model}/${method}`,
    {
      params: {
        model,
        method,
        args,
        kwargs,
      },
    },
    session,
  );
  return result;
}

export async function destroySession(session: string): Promise<void> {
  await rpc<unknown>(
    `${ODOO_URL}/web/session/destroy`,
    { params: {} },
    session,
  ).catch(() => undefined);
}

export function odooReportUrl(report: string, id: number): string {
  // Route through the same-origin Next.js proxy. Hitting Odoo's
  // /report/pdf directly fails for end users because the browser
  // doesn't carry the Odoo session cookie across to port 8069 —
  // Odoo bounces them to the storefront /shop login. The proxy
  // attaches the session server-side and streams the PDF back.
  return `/api/odoo-report?report=${encodeURIComponent(report)}&ids=${id}`;
}

export function odooImageUrl(
  model: string,
  id: number,
  field = "image_1024",
): string {
  return `${ODOO_URL}/web/image?model=${model}&id=${id}&field=${field}`;
}

export const odooConfig = {
  url: ODOO_URL,
  db: ODOO_DB,
};
