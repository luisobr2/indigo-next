/**
 * El endpoint donde la persona dice quien es.
 *
 * GET  -> muestra el formulario de acceso (usuario y contrasena de Odoo).
 * POST -> comprueba las credenciales contra Odoo, se emite una clave API a
 *         nombre de esa persona, y devuelve al cliente un codigo de un solo
 *         uso atado a su PKCE.
 *
 * ── Por que se emite una clave API aqui ──
 *
 * Las 13 herramientas del MCP llaman a Odoo con `execute_kw(uid, clave, ...)`.
 * Para que el token de OAuth sirva sin reescribirlas, tiene que llevar dentro
 * un par login+clave. La contrasena NO se guarda en ningun lado ni viaja mas
 * alla de esta peticion: se usa para autenticar y para emitir la clave, y se
 * descarta. La clave emitida queda listada en Odoo, a nombre de la persona, y
 * revocarla ahi corta el acceso al instante.
 *
 * ── Donde van los errores ──
 *
 * Regla de OAuth que es facil equivocar: mientras el `client_id` y el
 * `redirect_uri` no esten validados, un error se le muestra a la PERSONA. Solo
 * despues de validarlos se puede devolver el error al cliente por la
 * redireccion — si no, cualquiera podria mandar errores (y codigos) a una URL
 * de su eleccion usando este endpoint como trampolin.
 */
import { NextResponse } from "next/server";

import { rpcAuthenticate, rpcExecuteKw } from "@/lib/odoo/rpc";
import { issueAuthCode, readClientId, redirectUriAllowed } from "@/lib/mcp/oauth";

export const runtime = "nodejs";

const SUPPORTED_CHALLENGE_METHOD = "S256";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Una pagina de error para ojos humanos. Se usa solo cuando NO se puede
 *  confiar en la redireccion del cliente. */
function humanError(title: string, detail: string, status = 400) {
  return new NextResponse(
    page(`<h1>${esc(title)}</h1><p class="muted">${esc(detail)}</p>`),
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function page(inner: string): string {
  // Sin JavaScript y sin dependencias: esta pantalla tiene que funcionar
  // dentro del navegador incrustado que abren algunos clientes MCP, que no
  // siempre ejecutan lo mismo que un navegador completo.
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Indigo Decors — Conectar asistente</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f1f5f9; color:#0f172a; padding:24px;
         font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  .card { width:100%; max-width:400px; background:#fff; border:1px solid #e2e8f0;
          border-radius:16px; padding:28px; box-shadow:0 10px 30px rgba(15,23,42,.08); }
  h1 { font-size:19px; margin:0 0 6px; }
  .muted { color:#64748b; font-size:13px; margin:0 0 20px; }
  label { display:block; font-size:12px; font-weight:600; text-transform:uppercase;
          letter-spacing:.04em; color:#475569; margin:14px 0 5px; }
  input { width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:9px;
          font-size:15px; background:#fff; color:#0f172a; }
  input:focus { outline:2px solid #1f4486; outline-offset:1px; border-color:#1f4486; }
  button { width:100%; margin-top:20px; padding:11px; border:0; border-radius:9px;
           background:#1f4486; color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
  button:hover { background:#173463; }
  .err { margin:14px 0 0; padding:10px 12px; border-radius:9px; background:#fef2f2;
         border:1px solid #fecaca; color:#b91c1c; font-size:13px; }
  .app { display:inline-block; font-weight:600; color:#1f4486; }
  @media (prefers-color-scheme: dark) {
    body { background:#0b1120; color:#e8edf7; }
    .card { background:#131c30; border-color:#24304f; }
    .muted { color:#98a7c6; } label { color:#98a7c6; }
    input { background:#0f1729; border-color:#24304f; color:#e8edf7; }
    .err { background:#2d1420; border-color:#7f1d1d; color:#fca5a5; }
  }
</style>
</head><body><div class="card">${inner}</div></body></html>`;
}

interface Params {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  resource: string;
}

/** Valida lo que llega por la query. Devuelve o los parametros ya limpios, o
 *  una respuesta lista para enviar. */
function readParams(req: Request): Params | NextResponse {
  const url = new URL(req.url);
  const q = (k: string) => url.searchParams.get(k) ?? "";

  const clientId = q("client_id");
  const reg = readClientId(clientId, Date.now());
  if (!reg) {
    return humanError(
      "Aplicacion no reconocida",
      "El identificador de cliente no es valido o caduco. Quita la conexion en tu asistente y vuelve a anadirla.",
    );
  }

  const redirectUri = q("redirect_uri");
  if (!redirectUri || !redirectUriAllowed(redirectUri, reg.redirect_uris)) {
    // A partir de aqui SI se podria redirigir... pero justamente el destino es
    // lo que no valida, asi que este error se queda del lado humano.
    return humanError(
      "Redireccion no permitida",
      "La aplicacion pidio volver a una direccion que no declaro al registrarse.",
    );
  }

  // Desde aqui el destino es de fiar: los errores vuelven al cliente.
  const fail = (code: string, description: string) => {
    const back = new URL(redirectUri);
    back.searchParams.set("error", code);
    back.searchParams.set("error_description", description);
    if (q("state")) back.searchParams.set("state", q("state"));
    return NextResponse.redirect(back.toString(), 302);
  };

  if (q("response_type") !== "code") {
    return fail("unsupported_response_type", "Solo se admite response_type=code.");
  }
  if (q("code_challenge_method") !== SUPPORTED_CHALLENGE_METHOD) {
    return fail("invalid_request", "Se exige PKCE con code_challenge_method=S256.");
  }
  if (!q("code_challenge")) {
    return fail("invalid_request", "Falta code_challenge.");
  }

  return {
    clientId,
    clientName: reg.client_name,
    redirectUri,
    state: q("state"),
    codeChallenge: q("code_challenge"),
    scope: q("scope"),
    resource: q("resource"),
  };
}

function form(p: Params, error?: string): NextResponse {
  const hidden = (
    [
      ["client_id", p.clientId],
      ["redirect_uri", p.redirectUri],
      ["state", p.state],
      ["code_challenge", p.codeChallenge],
      ["scope", p.scope],
      ["resource", p.resource],
    ] as const
  )
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`)
    .join("");

  return new NextResponse(
    page(`
      <h1>Conectar <span class="app">${esc(p.clientName)}</span></h1>
      <p class="muted">Entra con tu usuario de Indigo. El asistente vera exactamente
      lo mismo que ves tu en el panel, y todo lo que haga quedara registrado a tu nombre.</p>
      <form method="post">
        ${hidden}
        <label for="login">Correo</label>
        <input id="login" name="login" type="email" autocomplete="username" required autofocus>
        <label for="password">Contrasena</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        ${error ? `<p class="err">${esc(error)}</p>` : ""}
        <button type="submit">Autorizar</button>
      </form>`),
    {
      status: error ? 401 : 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Nunca en cache: lleva el estado del flujo en los campos ocultos.
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(req: Request) {
  const p = readParams(req);
  return p instanceof NextResponse ? p : form(p);
}

export async function POST(req: Request) {
  const body = await req.formData();
  const get = (k: string) => String(body.get(k) ?? "");

  // Los parametros del flujo vuelven por los campos ocultos: se revalidan
  // igual que en el GET, sin confiar en que nadie los haya tocado.
  const rebuilt = new URL(req.url);
  for (const k of ["client_id", "redirect_uri", "state", "code_challenge", "scope", "resource"]) {
    rebuilt.searchParams.set(k, get(k));
  }
  rebuilt.searchParams.set("response_type", "code");
  rebuilt.searchParams.set("code_challenge_method", SUPPORTED_CHALLENGE_METHOD);
  const p = readParams(new Request(rebuilt.toString(), { headers: req.headers }));
  if (p instanceof NextResponse) return p;

  const login = get("login").trim();
  const password = get("password");
  if (!login || !password) return form(p, "Escribe el correo y la contrasena.");

  let uid: number | null;
  try {
    uid = await rpcAuthenticate(login, password);
  } catch {
    // Odoo caido no es una credencial mala. Decirle a alguien que su
    // contrasena esta mal cuando el servidor no responde lo manda a
    // cambiarla, que es exactamente lo que no hay que hacer.
    return form(p, "Odoo no responde ahora mismo. Intentalo de nuevo en unos segundos.");
  }
  if (!uid) return form(p, "Correo o contrasena incorrectos.");

  let apiKey: string;
  try {
    apiKey = await rpcExecuteKw<string>(uid, password, "res.users", "indigo_mcp_issue_key", [
      p.clientName,
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    // El addon lo rechaza explicitamente para cuentas de portal (dealers).
    if (msg.includes("no puede emitir claves")) {
      return form(p, "Esta cuenta no tiene acceso al asistente. Habla con la oficina.");
    }
    return form(p, "No se pudo emitir la credencial. Avisa a soporte.");
  }
  if (typeof apiKey !== "string" || !apiKey) {
    return form(p, "Odoo no devolvio una credencial valida. Avisa a soporte.");
  }

  const code = issueAuthCode(
    {
      login,
      apiKey,
      clientId: p.clientId,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
    },
    Date.now(),
  );

  const back = new URL(p.redirectUri);
  back.searchParams.set("code", code);
  if (p.state) back.searchParams.set("state", p.state);
  return NextResponse.redirect(back.toString(), 302);
}
