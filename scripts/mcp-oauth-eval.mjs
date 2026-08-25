#!/usr/bin/env node
/**
 * Recorre el flujo OAuth completo contra un servidor vivo y comprueba tambien
 * lo que tiene que FALLAR.
 *
 *   OAUTH_URL=https://app.indigodecors.com \
 *   OAUTH_LOGIN=... OAUTH_PASSWORD=... node scripts/mcp-oauth-eval.mjs
 *
 * Hermano de mcp-eval.mjs, que prueba las herramientas. Este prueba la puerta:
 * descubrimiento, registro, codigo, canje, renovacion, y que el token
 * resultante sirva de verdad para llamar al MCP.
 *
 * Los casos negativos son la mitad del valor. Un flujo OAuth que funciona
 * cuando todo va bien pero acepta un verifier equivocado no es un flujo OAuth,
 * es un formulario de login con pasos de mas.
 *
 * Emite una clave API real a nombre de OAUTH_LOGIN en cada corrida (es lo que
 * hace el flujo). Se listan en Odoo como "MCP OAuth - ..." y conviene limpiar
 * las de prueba de vez en cuando.
 */
import { createHash, randomBytes } from "node:crypto";

const BASE = (process.env.OAUTH_URL ?? "").replace(/\/+$/, "");
const LOGIN = process.env.OAUTH_LOGIN ?? "";
const PASSWORD = process.env.OAUTH_PASSWORD ?? "";
const REDIRECT = process.env.OAUTH_REDIRECT ?? "http://127.0.0.1:5599/callback";

if (!BASE || !LOGIN || !PASSWORD) {
  console.error("FATAL: faltan OAUTH_URL, OAUTH_LOGIN u OAUTH_PASSWORD.");
  process.exit(2);
}

let passed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? " — " + detail : ""}`);
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const json = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

// ── 1. Descubrimiento ──────────────────────────────────────────────────────
console.log("\n1. Descubrimiento");
const prm = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
const prmBody = await json(prm);
check("protected-resource responde 200", prm.status === 200, `HTTP ${prm.status}`);
check("declara el recurso MCP", prmBody?.resource === `${BASE}/api/mcp`, JSON.stringify(prmBody?.resource));
check("apunta a un servidor de autorizacion", Array.isArray(prmBody?.authorization_servers) && prmBody.authorization_servers.length > 0);

// La forma con el path del recurso detras: algunos clientes solo prueban esta.
const prm2 = await fetch(`${BASE}/.well-known/oauth-protected-resource/api/mcp`);
check("tambien en la forma con el path del recurso", prm2.status === 200, `HTTP ${prm2.status}`);

const asRes = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
const meta = await json(asRes);
check("authorization-server responde 200", asRes.status === 200, `HTTP ${asRes.status}`);
check("anuncia S256 y NADA de plain", JSON.stringify(meta?.code_challenge_methods_supported) === '["S256"]', JSON.stringify(meta?.code_challenge_methods_supported));
check("anuncia registro dinamico", typeof meta?.registration_endpoint === "string");

// El 401 del MCP tiene que decir donde esta el metadata, o el cliente no
// descubre nada.
const unauth = await fetch(`${BASE}/api/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
const wwwAuth = unauth.headers.get("www-authenticate") ?? "";
check("el 401 del MCP trae resource_metadata", unauth.status === 401 && wwwAuth.includes("resource_metadata="), `${unauth.status} / ${wwwAuth}`);

// ── 2. Registro ────────────────────────────────────────────────────────────
console.log("\n2. Registro dinamico");
const reg = await fetch(meta.registration_endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_name: "eval", redirect_uris: [REDIRECT] }),
});
const client = await json(reg);
check("registra y devuelve client_id", reg.status === 201 && !!client?.client_id, `HTTP ${reg.status}`);

const badReg = await fetch(meta.registration_endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_name: "eval", redirect_uris: ["http://malo.com/cb"] }),
});
check("rechaza http contra un host que no es loopback", badReg.status === 400, `HTTP ${badReg.status}`);

// ── 3. Autorizacion ────────────────────────────────────────────────────────
console.log("\n3. Autorizacion");
const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(8).toString("hex");

const authUrl = new URL(meta.authorization_endpoint);
for (const [k, v] of Object.entries({
  response_type: "code",
  client_id: client.client_id,
  redirect_uri: REDIRECT,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state,
  resource: `${BASE}/api/mcp`,
})) authUrl.searchParams.set(k, v);

const formPage = await fetch(authUrl);
const html = await formPage.text();
check("muestra el formulario", formPage.status === 200 && html.includes('name="password"'), `HTTP ${formPage.status}`);
check("no filtra la contrasena en la pagina", !html.includes(PASSWORD));

// Redireccion no declarada: no puede terminar en redireccion.
const evil = new URL(authUrl);
evil.searchParams.set("redirect_uri", "https://malo.com/robar");
const evilRes = await fetch(evil, { redirect: "manual" });
check("rechaza una redirect_uri no declarada", evilRes.status === 400, `HTTP ${evilRes.status}`);

// PKCE plain: prohibido.
const plain = new URL(authUrl);
plain.searchParams.set("code_challenge_method", "plain");
const plainRes = await fetch(plain, { redirect: "manual" });
const plainLoc = plainRes.headers.get("location") ?? "";
check("rechaza PKCE plain", plainRes.status === 302 && plainLoc.includes("error=invalid_request"), `${plainRes.status} ${plainLoc}`);

// Credenciales malas.
const badLogin = await fetch(authUrl, {
  method: "POST",
  redirect: "manual",
  body: new URLSearchParams({
    client_id: client.client_id, redirect_uri: REDIRECT, state,
    code_challenge: challenge, scope: "", resource: "",
    login: LOGIN, password: "definitivamente-no-es",
  }),
});
check("rechaza una contrasena mala sin redirigir", badLogin.status === 401, `HTTP ${badLogin.status}`);

// El bueno.
const authed = await fetch(authUrl, {
  method: "POST",
  redirect: "manual",
  body: new URLSearchParams({
    client_id: client.client_id, redirect_uri: REDIRECT, state,
    code_challenge: challenge, scope: "", resource: `${BASE}/api/mcp`,
    login: LOGIN, password: PASSWORD,
  }),
});
const loc = authed.headers.get("location") ?? "";
check("autoriza y redirige con codigo", authed.status === 302 && loc.startsWith(REDIRECT), `${authed.status} ${loc.slice(0, 120)}`);
const back = new URL(loc || "http://x/");
const code = back.searchParams.get("code") ?? "";
check("devuelve el state intacto", back.searchParams.get("state") === state);
check("hay codigo", code.length > 20);

// ── 4. Canje ───────────────────────────────────────────────────────────────
console.log("\n4. Canje del codigo");
const exchange = (params) =>
  fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

const wrongVerifier = await exchange({
  grant_type: "authorization_code", code, redirect_uri: REDIRECT,
  client_id: client.client_id, code_verifier: randomBytes(48).toString("base64url"),
});
check("rechaza un code_verifier equivocado", wrongVerifier.status === 400, `HTTP ${wrongVerifier.status}`);

const tokRes = await exchange({
  grant_type: "authorization_code", code, redirect_uri: REDIRECT,
  client_id: client.client_id, code_verifier: verifier,
});
const tok = await json(tokRes);
check("canjea el codigo", tokRes.status === 200 && !!tok?.access_token, `HTTP ${tokRes.status} ${JSON.stringify(tok)?.slice(0, 160)}`);
check("devuelve refresh token", !!tok?.refresh_token);
check("el token no lleva la contrasena dentro", !String(tok?.access_token).includes(PASSWORD));

// ── 5. El token sirve de verdad ────────────────────────────────────────────
console.log("\n5. El token contra el MCP");
const callMcp = (bearer) =>
  fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

const listed = await callMcp(tok.access_token);
const listedText = await listed.text();
check("tools/list responde 200", listed.status === 200, `HTTP ${listed.status}`);
check("se ven las herramientas", listedText.includes("today_board"), listedText.slice(0, 160));

const asAccess = await callMcp(tok.refresh_token);
check("el refresh token NO abre el MCP", asAccess.status === 401, `HTTP ${asAccess.status}`);

// ── 6. Renovacion ──────────────────────────────────────────────────────────
console.log("\n6. Renovacion");
const refreshed = await exchange({ grant_type: "refresh_token", refresh_token: tok.refresh_token });
const newTok = await json(refreshed);
check("renueva", refreshed.status === 200 && !!newTok?.access_token, `HTTP ${refreshed.status}`);
const afterRefresh = await callMcp(newTok?.access_token ?? "x");
check("el token renovado tambien sirve", afterRefresh.status === 200, `HTTP ${afterRefresh.status}`);

// ── Resumen ────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} ok, ${failures.length} fallos ===`);
if (failures.length) {
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
