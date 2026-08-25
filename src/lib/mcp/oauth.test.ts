import test from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET ??= "x".repeat(48);

import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  OAUTH_TOKEN_PREFIX,
  issueAccessToken,
  issueAuthCode,
  issueClientId,
  issueRefreshToken,
  readAccessToken,
  readAuthCode,
  readClientId,
  readRefreshToken,
  redirectUriAllowed,
  seal,
  open,
  verifyPkce,
} from "./oauth.ts";
import { createHash } from "node:crypto";

const NOW = 1_700_000_000_000;
const CRED = { login: "majela@indigodecors.com", apiKey: "abc123def456" };

// ---------------------------------------------------------------------
// El codec. Todo lo demas descansa en esto.
// ---------------------------------------------------------------------

test("un token abierto devuelve lo que se cerro", () => {
  const t = issueAccessToken(CRED, NOW);
  assert.deepEqual(readAccessToken(t, NOW), CRED);
});

test("el token no revela la credencial que lleva dentro", () => {
  // Va cifrado, no solo firmado: adentro hay una clave API viva.
  const t = issueAccessToken(CRED, NOW);
  assert.ok(!t.includes(CRED.apiKey));
  assert.ok(!t.includes(CRED.login));
  assert.ok(!Buffer.from(t, "utf8").toString("base64").includes(CRED.apiKey));
});

test("caduca", () => {
  const t = issueAccessToken(CRED, NOW);
  const justBefore = NOW + ACCESS_TOKEN_TTL_SECONDS * 1000 - 1;
  assert.ok(readAccessToken(t, justBefore), "deberia servir un ms antes");
  assert.equal(readAccessToken(t, NOW + ACCESS_TOKEN_TTL_SECONDS * 1000), null);
});

test("un codigo de autorizacion caduca en un minuto, no en horas", () => {
  const code = issueAuthCode(
    { ...CRED, clientId: "cid", redirectUri: "https://x/cb", codeChallenge: "ch" },
    NOW,
  );
  assert.ok(readAuthCode(code, NOW + 59_000));
  assert.equal(readAuthCode(code, NOW + AUTH_CODE_TTL_SECONDS * 1000), null);
});

test("manipular cualquier parte lo invalida", () => {
  const t = issueAccessToken(CRED, NOW);
  const parts = t.slice(OAUTH_TOKEN_PREFIX.length).split(".");
  for (let i = 1; i < parts.length; i++) {
    const broken = [...parts];
    // Cambiar un caracter del medio, manteniendo el largo.
    const s = broken[i];
    broken[i] = s.slice(0, 2) + (s[2] === "A" ? "B" : "A") + s.slice(3);
    const forged = OAUTH_TOKEN_PREFIX + broken.join(".");
    assert.equal(readAccessToken(forged, NOW), null, `parte ${i} deberia romper el tag`);
  }
});

test("basura no rompe el codec", () => {
  for (const bad of ["", "  ", "no-es-un-token", `${OAUTH_TOKEN_PREFIX}access.a.b`, `${OAUTH_TOKEN_PREFIX}access....`]) {
    assert.equal(readAccessToken(bad, NOW), null, `deberia rechazar ${JSON.stringify(bad)}`);
  }
  assert.equal(readAccessToken(null, NOW), null);
  assert.equal(readAccessToken(undefined, NOW), null);
});

// ---------------------------------------------------------------------
// Separacion por proposito. Es lo que impide que un artefacto barato del
// flujo se presente como uno caro.
// ---------------------------------------------------------------------

test("un refresh token no vale como access token, ni al reves", () => {
  const refresh = issueRefreshToken(CRED, NOW);
  assert.equal(readAccessToken(refresh, NOW), null);
  const access = issueAccessToken(CRED, NOW);
  assert.equal(readRefreshToken(access, NOW), null);
});

test("un codigo de autorizacion no vale como access token", () => {
  // Si valiera, el codigo que viaja por la barra del navegador -- visible en
  // el historial y en los logs del proxy -- seria una credencial de 8 horas.
  const code = issueAuthCode(
    { ...CRED, clientId: "cid", redirectUri: "https://x/cb", codeChallenge: "ch" },
    NOW,
  );
  assert.equal(readAccessToken(code, NOW), null);
});

test("cambiarle el proposito a la etiqueta no lo reetiqueta", () => {
  const refresh = issueRefreshToken(CRED, NOW);
  const relabeled = refresh.replace(`${OAUTH_TOKEN_PREFIX}refresh.`, `${OAUTH_TOKEN_PREFIX}access.`);
  assert.equal(readAccessToken(relabeled, NOW), null);
});

test("un payload sin los campos que importan se rechaza aunque descifre", () => {
  const empty = seal("access", {}, 3600, NOW);
  assert.ok(open("access", empty, NOW), "el sobre en si es valido");
  assert.equal(readAccessToken(empty, NOW), null, "pero sin credencial no sirve");
});

// ---------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------

const VERIFIER = "a".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

test("S256 valido pasa", () => {
  assert.equal(verifyPkce(VERIFIER, CHALLENGE, "S256"), true);
});

test("verifier equivocado no pasa", () => {
  assert.equal(verifyPkce("b".repeat(64), CHALLENGE, "S256"), false);
});

test("plain se rechaza aunque coincida", () => {
  // OAuth 2.1 lo prohibe: con plain el codigo deja de estar atado a quien
  // inicio el flujo, asi que quien lo intercepte se lo puede canjear.
  assert.equal(verifyPkce(VERIFIER, VERIFIER, "plain"), false);
  assert.equal(verifyPkce(VERIFIER, CHALLENGE, ""), false);
});

test("un verifier demasiado corto se rechaza", () => {
  const short = "abc";
  const ch = createHash("sha256").update(short).digest("base64url");
  assert.equal(verifyPkce(short, ch, "S256"), false);
});

// ---------------------------------------------------------------------
// Registro de clientes y redirecciones
// ---------------------------------------------------------------------

test("el client_id lleva su propio registro", () => {
  const cid = issueClientId(
    { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] },
    NOW,
  );
  const back = readClientId(cid, NOW);
  assert.equal(back?.client_name, "Claude");
  assert.deepEqual(back?.redirect_uris, ["https://claude.ai/api/mcp/auth_callback"]);
});

test("un client_id inventado no abre", () => {
  assert.equal(readClientId("imcp_client.aaa.bbb.ccc", NOW), null);
  assert.equal(readClientId("cualquier-cosa", NOW), null);
});

test("la redireccion se compara exacta, no por prefijo", () => {
  const reg = ["https://claude.ai/callback"];
  assert.equal(redirectUriAllowed("https://claude.ai/callback", reg), true);
  // El agujero clasico: un prefijo valido con otro host detras.
  assert.equal(redirectUriAllowed("https://claude.ai/callback.malo.com", reg), false);
  assert.equal(redirectUriAllowed("https://claude.ai/callback/../x", reg), false);
  assert.equal(redirectUriAllowed("https://malo.com/callback", reg), false);
});

test("localhost puede cambiar de puerto, y solo localhost", () => {
  // El cliente de escritorio elige el puerto al arrancar, asi que no lo puede
  // declarar de antemano (RFC 8252).
  const reg = ["http://127.0.0.1:3334/oauth/callback"];
  assert.equal(redirectUriAllowed("http://127.0.0.1:51823/oauth/callback", reg), true);
  assert.equal(redirectUriAllowed("http://localhost:9999/oauth/callback", reg), true);
  // Pero no otra ruta, ni otro host, ni https falso.
  assert.equal(redirectUriAllowed("http://127.0.0.1:51823/otra", reg), false);
  assert.equal(redirectUriAllowed("http://malo.com:3334/oauth/callback", reg), false);
  assert.equal(
    redirectUriAllowed("http://127.0.0.1:1/cb", ["https://app.indigodecors.com/cb"]),
    false,
  );
});

test("una redireccion que no parsea se rechaza", () => {
  assert.equal(redirectUriAllowed("no-es-url", ["http://127.0.0.1:1/cb"]), false);
});
