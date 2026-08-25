#!/usr/bin/env node
/**
 * Conecta un cliente de IA de escritorio al MCP de Indigo.
 *
 *   node scripts/setup-mcp-client.mjs <desktop|codex|claude-code|all> --token <token>
 *
 * Existe porque cada cliente quiere el token en un lugar distinto y ninguno de
 * los tres formatos es adivinable. Pedirle a Majela que edite un JSON con rutas
 * de Windows escapadas es pedirle que lo rompa.
 *
 * El token es `<login_odoo>.<api_key>` y va ENTERO, con el email adelante.
 *
 * ── Por que Desktop arranca `node ruta/proxy.js` y no `npx mcp-remote` ──
 *
 * El servidor habla HTTP, y Claude Desktop solo sabe arrancar procesos que
 * hablan por stdio, asi que en el medio va `mcp-remote` como puente. Las tres
 * formas de arrancarlo NO son equivalentes en Windows:
 *
 *   command="npx"          -> ENOENT. En Windows npx es npx.cmd, y desde
 *                             Node 18.20 spawn() ya no ejecuta .cmd sin shell.
 *   command="cmd" /c npx   -> arranca y dice "Proxy established successfully",
 *                             pero el stdin NUNCA llega al puente: cmd.exe se
 *                             come las lineas JSON-RPC e intenta ejecutarlas
 *                             ('{"jsonrpc":"2.0"' is not recognized as an
 *                             internal or external command). El cliente se
 *                             queda esperando para siempre. Este es el modo de
 *                             falla feo, porque los logs dicen que conecto.
 *   command="node" ruta.js -> funciona. Verificado extremo a extremo contra
 *                             produccion, con el entorno recortado a lo que
 *                             Desktop realmente pasa.
 *
 * Ademas evita que npx resuelva y descargue el paquete en cada arranque del
 * cliente, que es lento y falla sin internet.
 *
 * ── Por que el header es `Authorization:${VAR}` sin espacio ──
 *
 * El valor real vive en `env`, no en los argumentos: los argumentos de un
 * proceso los ve cualquiera en el listado de procesos de la maquina, y este
 * token abre las 13 herramientas, 5 de ellas de escritura. mcp-remote sustituye
 * `${VAR}` por el valor del entorno. Sin espacio en el argumento porque el
 * espacio es justo lo que rompe el parseo cuando algun cliente decide meter un
 * shell en el medio.
 */
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const URL_MCP = "https://app.indigodecors.com/api/mcp";
const BRIDGE_DIR = platform() === "win32" ? "C:\\MCPS\\indigo-mcp" : join(homedir(), ".indigo-mcp");
const BRIDGE_ENTRY = join(BRIDGE_DIR, "node_modules", "mcp-remote", "dist", "proxy.js");
const MCP_REMOTE = "mcp-remote@0.2.1"; // fijado: un puente que cambia solo es un puente que se rompe solo

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--")) ?? "all";
const token = (args[args.indexOf("--token") + 1] ?? process.env.INDIGO_MCP_TOKEN ?? "").trim();

function fatal(msg) {
  console.error("\n  " + msg + "\n");
  process.exit(1);
}

if (!["desktop", "codex", "claude-code", "all"].includes(target)) {
  fatal(`Cliente desconocido: "${target}". Usa desktop, codex, claude-code o all.`);
}
if (!token) {
  fatal(
    "Falta el token. Pasalo con --token o en INDIGO_MCP_TOKEN.\n" +
      "  Se saca en Odoo: avatar -> Mi perfil -> Seguridad de la cuenta -> Nueva clave API.\n" +
      "  Va entero: tuemail@indigodecors.com.<clave>",
  );
}
if (!token.includes("@") || !token.includes(".")) {
  fatal(
    "Ese token no tiene la forma esperada `<login>.<clave>`.\n" +
      "  El error mas comun es pegar solo la clave y perder el email de adelante.",
  );
}

/** Copia de seguridad con marca de tiempo antes de tocar la config de nadie. */
function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.bak-${stamp}`;
  copyFileSync(file, dest);
  return dest;
}

function installBridge() {
  if (existsSync(BRIDGE_ENTRY)) {
    console.log(`  puente ya instalado en ${BRIDGE_DIR}`);
    return;
  }
  console.log(`  instalando el puente en ${BRIDGE_DIR} ...`);
  mkdirSync(BRIDGE_DIR, { recursive: true });
  writeFileSync(
    join(BRIDGE_DIR, "package.json"),
    JSON.stringify({ name: "indigo-mcp-bridge", private: true, version: "1.0.0" }, null, 2),
  );
  execFileSync("npm", ["i", "--no-save", MCP_REMOTE], {
    cwd: BRIDGE_DIR,
    stdio: "inherit",
    shell: platform() === "win32",
  });
  if (!existsSync(BRIDGE_ENTRY)) fatal(`npm dijo que instalo pero no aparece ${BRIDGE_ENTRY}`);
}

function desktopConfigPath() {
  if (platform() === "win32") return join(process.env.APPDATA, "Claude", "claude_desktop_config.json");
  if (platform() === "darwin")
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function setupDesktop() {
  console.log("\nClaude Desktop");
  const file = desktopConfigPath();
  if (!existsSync(file)) {
    fatal(
      `No encuentro la config de Claude Desktop en:\n    ${file}\n` +
        "  Abri Claude Desktop una vez (Ajustes -> Desarrollador) para que la cree, y volve a correr esto.",
    );
  }
  installBridge();
  console.log("  respaldo:", backup(file));

  const cfg = JSON.parse(readFileSync(file, "utf8"));
  cfg.mcpServers ??= {};
  cfg.mcpServers.indigo = {
    command: platform() === "win32" ? "C:\\Program Files\\nodejs\\node.exe" : process.execPath,
    args: [BRIDGE_ENTRY, URL_MCP, "--header", "Authorization:${INDIGO_AUTH}"],
    env: { INDIGO_AUTH: `Bearer ${token}` },
  };
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  console.log("  escrito. Cerra y volve a abrir Claude Desktop (del todo, no solo la ventana).");
  return { command: cfg.mcpServers.indigo.command, args: cfg.mcpServers.indigo.args, env: cfg.mcpServers.indigo.env };
}

/** En Windows `claude` y `codex` son .cmd, asi que execFileSync necesita shell.
 *  Pero el shell vuelve a partir la linea por espacios, y el header lleva uno
 *  ("Bearer <token>"): sin comillas le llega cortado al CLI, que responde
 *  «Invalid header format: "Bearer"». Con shell:false el .cmd ni siquiera
 *  arranca (Node 18.20+ dejo de ejecutar .cmd sin shell). Comillas, entonces. */
function runCli(bin, argv) {
  const win = platform() === "win32";
  execFileSync(bin, win ? argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : argv, {
    stdio: "inherit",
    shell: win,
  });
}

function setupCodex() {
  // Codex habla streamable HTTP nativo: no necesita puente. El token lo lee de
  // una variable de entorno, no de la config, asi que hay que fijarla aparte.
  console.log("\nCodex");
  try {
    execFileSync("codex", ["mcp", "remove", "indigo"], { stdio: "ignore", shell: platform() === "win32" });
  } catch {
    /* no estaba: es el caso normal la primera vez */
  }
  runCli("codex", ["mcp", "add", "indigo", "--url", URL_MCP, "--bearer-token-env-var", "INDIGO_MCP_TOKEN"]);
  if (platform() === "win32") {
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `[Environment]::SetEnvironmentVariable('INDIGO_MCP_TOKEN', $env:INDIGO_SETUP_TOKEN, 'User')`,
    ], { stdio: "inherit", env: { ...process.env, INDIGO_SETUP_TOKEN: token } });
    console.log("  INDIGO_MCP_TOKEN fijada a nivel usuario. Abri una terminal NUEVA para que exista.");
  } else {
    console.log(`  Agrega a tu ~/.bashrc o ~/.zshrc:\n    export INDIGO_MCP_TOKEN='${"<tu token>"}'`);
  }
}

function setupClaudeCode() {
  // Claude Code tambien habla HTTP nativo y acepta headers directo.
  console.log("\nClaude Code");
  try {
    execFileSync("claude", ["mcp", "remove", "--scope", "user", "indigo"], {
      stdio: "ignore",
      shell: platform() === "win32",
    });
  } catch {
    /* no estaba */
  }
  runCli("claude", [
    "mcp", "add", "--transport", "http", "--scope", "user", "indigo", URL_MCP,
    "--header", `Authorization: Bearer ${token}`,
  ]);
}

/** Arranca el puente igual que lo hara el cliente y confirma que responde.
 *  Sin esto el script solo probaria que sabe escribir JSON. */
function verify(entry) {
  return new Promise((resolve) => {
    console.log("\nVerificando contra produccion ...");
    const child = spawn(entry.command, entry.args, {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...entry.env, PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, TEMP: process.env.TEMP },
    });
    let buf = "";
    let done = false;
    const finish = (ok, msg) => {
      if (done) return;
      done = true;
      child.kill();
      console.log("  " + msg);
      resolve(ok);
    };
    child.stdout.on("data", (d) => {
      buf += d.toString();
      for (const line of buf.split("\n")) {
        try {
          const m = JSON.parse(line);
          if (m.id === 2 && m.result?.tools) finish(true, `OK: ${m.result.tools.length} herramientas visibles.`);
          if (m.id === 2 && m.error) finish(false, "El servidor respondio con error: " + JSON.stringify(m.error));
        } catch {
          /* linea parcial o log del puente */
        }
      }
    });
    const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "setup", version: "1" } } });
    setTimeout(() => { send({ jsonrpc: "2.0", method: "notifications/initialized" }); send({ jsonrpc: "2.0", id: 2, method: "tools/list" }); }, 6000);
    setTimeout(() => finish(false, "Sin respuesta en 25s. Revisa el token y la conexion."), 25000);
  });
}

let desktopEntry = null;
if (target === "desktop" || target === "all") desktopEntry = setupDesktop();
if (target === "codex" || target === "all") setupCodex();
if (target === "claude-code" || target === "all") setupClaudeCode();

if (desktopEntry) {
  const ok = await verify(desktopEntry);
  if (!ok) process.exit(1);
} else {
  console.log("\nListo. Probalo pidiendole al asistente: \"que hay para pintar hoy\".");
}
