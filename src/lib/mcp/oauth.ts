/**
 * OAuth 2.1 para el servidor MCP: codec de los tres tokens del flujo.
 *
 * ── Por que no hay base de datos ──
 *
 * El panel no tiene almacenamiento propio: habla con Odoo y nada mas. Montar
 * una tabla de clientes registrados, codigos y tokens habria significado o un
 * modelo nuevo en el addon (con su deploy y su upgrade cada vez) o un archivo
 * en el contenedor, que se pierde en cada despliegue. Asi que no se guarda
 * nada: cada artefacto del flujo es un blob autocontenido, firmado o cifrado
 * con una clave derivada de SESSION_SECRET. El servidor no recuerda haber
 * emitido nada; lo verifica al recibirlo.
 *
 * ── Que lleva adentro el access token, y por que eso resuelve la revocacion ──
 *
 * Las 13 herramientas llaman a Odoo con `execute_kw(uid, apiKey, ...)`: estan
 * atadas a un par login+clave API, no a una sesion. Asi que el access token
 * lleva ese par cifrado. Dos consecuencias buenas:
 *
 *   1. Ni una sola herramienta cambia. El token de OAuth se abre, sale el
 *      mismo par que hoy llega por el header, y de ahi para abajo todo es
 *      identico -- incluidas las ACL de Odoo, que siguen aplicandose porque
 *      cada llamada corre como esa persona.
 *   2. **Revocar sigue siendo borrar la clave API en Odoo.** No hace falta una
 *      lista de tokens revocados ni un endpoint nuevo: el token es opaco para
 *      el cliente, pero por dentro es una credencial que Odoo puede matar. Un
 *      token cuya clave ya no existe deja de servir en la siguiente llamada.
 *
 * Por eso van CIFRADOS y no solo firmados: un blob firmado es legible, y este
 * contiene una credencial viva.
 *
 * ── Separacion por proposito ──
 *
 * El proposito va como AAD del AES-GCM, igual que va dentro del MAC en las
 * cookies de sesion (ver ../odoo/session-cookie.ts). Un access token no se
 * puede presentar como refresh token ni un codigo de autorizacion como access
 * token, aunque compartan clave y forma.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { requireSessionSecret } from "../odoo/session-cookie.ts";

/** Prefijo de todo token emitido por este flujo. Sirve para distinguirlo sin
 *  ambiguedad del bearer historico `<login>.<apiKey>`, que se sigue
 *  aceptando: un login de Odoo es un email, nunca empieza asi. */
export const OAUTH_TOKEN_PREFIX = "imcp_";

export const ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Un codigo de autorizacion viaja por la barra del navegador y se canjea
 *  inmediatamente. Vive lo justo para el viaje de vuelta. */
export const AUTH_CODE_TTL_SECONDS = 60;

type Purpose = "client" | "code" | "access" | "refresh";

/** Claves distintas por proposito, derivadas del mismo secreto. Que el AAD ya
 *  separe los propositos no quita valor a derivar tambien la clave: si un dia
 *  alguien olvida pasar el AAD, la separacion sigue en pie. */
function keyFor(purpose: Purpose): Buffer {
  const secret = requireSessionSecret();
  return Buffer.from(hkdfSync("sha256", secret, "indigo-mcp-oauth", purpose, 32));
}

function b64url(b: Buffer): string {
  return b.toString("base64url");
}

/**
 * Cifra un objeto con AES-256-GCM y le pone caducidad.
 *
 * Formato: `imcp_<purpose>.<iv>.<ciphertext>.<tag>` (todo base64url).
 * El proposito viaja en claro *y* como AAD: en claro para poder elegir la
 * clave antes de descifrar, como AAD para que no se pueda cambiar.
 */
export function seal(
  purpose: Purpose,
  payload: Record<string, unknown>,
  ttlSeconds: number,
  now: number,
): string {
  const body = JSON.stringify({ ...payload, exp: now + ttlSeconds * 1000 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const ct = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
  return `${OAUTH_TOKEN_PREFIX}${purpose}.${b64url(iv)}.${b64url(ct)}.${b64url(cipher.getAuthTag())}`;
}

/**
 * Abre lo que `seal` cerro. Devuelve null ante cualquier problema — formato,
 * proposito equivocado, manipulacion, caducidad — sin distinguir cual, para
 * no convertir el codec en un oraculo.
 */
export function open<T = Record<string, unknown>>(
  purpose: Purpose,
  raw: string | undefined | null,
  now: number,
): T | null {
  if (!raw || !raw.startsWith(`${OAUTH_TOKEN_PREFIX}${purpose}.`)) return null;
  const parts = raw.slice(OAUTH_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 4) return null;
  const [got, ivRaw, ctRaw, tagRaw] = parts;
  if (got !== purpose) return null;
  try {
    // keyFor() va DENTRO del try a proposito: lanza si falta SESSION_SECRET, y
    // un servidor mal configurado tiene que responder "token invalido" (401),
    // no reventar con un 500 que sugiere que el token era bueno.
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFor(purpose),
      Buffer.from(ivRaw, "base64url"),
    );
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const out = Buffer.concat([
      decipher.update(Buffer.from(ctRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(out) as T & { exp?: number };
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    return payload;
  } catch {
    // Tag invalido, base64 roto, JSON roto: todo es "no sirve".
    return null;
  }
}

// ─────────────────────────── Registro de clientes ───────────────────────────

export interface ClientRegistration {
  client_name: string;
  redirect_uris: string[];
}

/**
 * El `client_id` ES el registro, cifrado.
 *
 * Registro dinamico (RFC 7591) obliga a aceptar clientes que aparecen solos:
 * Claude Desktop se registra la primera vez que alguien lo conecta. Guardarlos
 * exigiria una tabla. Como lo unico que hay que recordar de un cliente son sus
 * redirect_uris — y hay que recordarlas para poder rechazar una redireccion
 * que no declaro — el propio identificador las lleva. Nada que guardar, nada
 * que limpiar, y un client_id manipulado simplemente no abre.
 *
 * Caduca a 1 ano: es lo que evita que un client_id filtrado sirva para
 * siempre, y volver a registrarse le cuesta al cliente una llamada.
 */
export function issueClientId(reg: ClientRegistration, now: number): string {
  return seal("client", { ...reg }, 365 * 24 * 60 * 60, now);
}

export function readClientId(raw: string | null | undefined, now: number): ClientRegistration | null {
  const p = open<ClientRegistration>("client", raw, now);
  if (!p || !Array.isArray(p.redirect_uris) || p.redirect_uris.length === 0) return null;
  return { client_name: String(p.client_name ?? "MCP client"), redirect_uris: p.redirect_uris };
}

// ──────────────────────────────── PKCE ─────────────────────────────────────

/**
 * Comprueba el verifier contra el challenge (RFC 7636).
 *
 * Solo S256. `plain` esta permitido por el RFC pero lo prohibe OAuth 2.1, y
 * aceptarlo dejaria que quien intercepte el codigo se lo canjee: con `plain`
 * el challenge y el verifier son la misma cadena, asi que el codigo deja de
 * estar atado a quien inicio el flujo.
 */
export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== "S256") return false;
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  const expected = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(challenge ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ──────────────────────── Codigo y tokens del usuario ───────────────────────

export interface OdooCredential {
  login: string;
  apiKey: string;
}

export interface AuthCodePayload extends OdooCredential {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
}

export function issueAuthCode(p: AuthCodePayload, now: number): string {
  return seal("code", { ...p }, AUTH_CODE_TTL_SECONDS, now);
}

export function readAuthCode(raw: string | null | undefined, now: number): AuthCodePayload | null {
  const p = open<AuthCodePayload>("code", raw, now);
  if (!p?.login || !p?.apiKey || !p?.clientId || !p?.redirectUri || !p?.codeChallenge) return null;
  return p;
}

export function issueAccessToken(c: OdooCredential, now: number): string {
  return seal("access", { ...c }, ACCESS_TOKEN_TTL_SECONDS, now);
}

export function readAccessToken(raw: string | null | undefined, now: number): OdooCredential | null {
  const p = open<OdooCredential>("access", raw, now);
  return p?.login && p?.apiKey ? { login: p.login, apiKey: p.apiKey } : null;
}

export function issueRefreshToken(c: OdooCredential, now: number): string {
  return seal("refresh", { ...c }, REFRESH_TOKEN_TTL_SECONDS, now);
}

export function readRefreshToken(raw: string | null | undefined, now: number): OdooCredential | null {
  const p = open<OdooCredential>("refresh", raw, now);
  return p?.login && p?.apiKey ? { login: p.login, apiKey: p.apiKey } : null;
}

/**
 * Solo se admiten redirecciones que el cliente declaro al registrarse, y por
 * igualdad exacta.
 *
 * Comparar por prefijo es el agujero clasico: quien declara
 * `https://claude.ai/callback` podria redirigir a
 * `https://claude.ai/callback.attacker.com` y llevarse el codigo. La unica
 * excepcion es `http://localhost:<puerto>`, donde el puerto lo elige el
 * cliente en tiempo de ejecucion y no lo puede declarar de antemano (RFC 8252
 * lo contempla). Ahi se compara todo menos el puerto, y solo para localhost.
 */
export function redirectUriAllowed(candidate: string, registered: string[]): boolean {
  if (registered.includes(candidate)) return true;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false;
  if (url.protocol !== "http:") return false;
  return registered.some((r) => {
    try {
      const reg = new URL(r);
      return (
        reg.protocol === "http:" &&
        (reg.hostname === "127.0.0.1" || reg.hostname === "localhost") &&
        reg.pathname === url.pathname
      );
    } catch {
      return false;
    }
  });
}
