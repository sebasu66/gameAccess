/**
 * Builds the folder Windows Sandbox mounts for a pass on a clean Windows, and the .wsb that opens it:
 *
 *   node regress/sandbox/make-kit.mjs [--kit <folder>] [--steam-setup <SteamSetup.exe>]
 *
 * The kit holds the test installer (apps/desktop built with VITE_GA_TEST=1, see the README), this tool with its
 * node_modules, a portable Node (this one's node.exe), and, in secret/, copies of what lives only in vault/Cuentas
 * (ignored by git): the Steam test accounts (accFull.csv), a PLUS key (plus-key.txt, first line) and the source
 * plugin's install link (the gameaccess:// link its page's button opens, read from the page named in
 * plugin-page.txt, or taken as is from plugin-link.txt). in-sandbox.ps1 deletes
 * secret/ when it ends. Opening gameaccess.wsb runs it; the reports are left in <kit>/out.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = resolve(HERE, "..", "..");
const REPO = resolve(TOOL, "..", "..");
const NSIS = join(REPO, "apps", "desktop", "src-tauri", "target", "sandbox", "release", "bundle", "nsis");
const SECRETS = join(REPO, "vault", "Cuentas");
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const kit = resolve(option("--kit") ?? join(process.env.LOCALAPPDATA, "GameAccess-MCP", "sandbox"));

const installers = existsSync(NSIS) ? readdirSync(NSIS).filter(name => name.endsWith("-setup.exe")) : [];
if (!installers.length) throw new Error(`No test installer in ${NSIS}: build it first (README, Windows Sandbox).`);
const installer = installers.map(name => join(NSIS, name)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

// A previous kit's reports stay; everything else is replaced.
for (const part of ["app", "mcp", "node", "secret"]) rmSync(join(kit, part), { recursive: true, force: true });
mkdirSync(join(kit, "app"), { recursive: true });
mkdirSync(join(kit, "node"), { recursive: true });
mkdirSync(join(kit, "secret"), { recursive: true });
mkdirSync(join(kit, "out"), { recursive: true });
copyFileSync(installer, join(kit, "app", "gameaccess-setup.exe"));
copyFileSync(process.execPath, join(kit, "node", "node.exe"));
cpSync(TOOL, join(kit, "mcp"), { recursive: true, filter: path => !/[\\/]\.git([\\/]|$)/.test(path) });
const steamSetup = option("--steam-setup");
if (steamSetup) copyFileSync(steamSetup, join(kit, "app", "SteamSetup.exe"));

const copied = [];
for (const [from, to] of [["accFull.csv", "accounts.csv"], ["plus-key.txt", "plus-key.txt"], ["plugin-link.txt", "plugin-link.txt"]]) {
  if (existsSync(join(SECRETS, from))) { copyFileSync(join(SECRETS, from), join(kit, "secret", to)); copied.push(to); }
}
// The plugin's page (its address in plugin-page.txt): the link its install button has today, so a new release is
// what the pass installs, as a user would.
if (!copied.includes("plugin-link.txt") && existsSync(join(SECRETS, "plugin-page.txt"))) {
  const page = readFileSync(join(SECRETS, "plugin-page.txt"), "utf8").trim();
  const html = await (await fetch(page)).text();
  const link = /gameaccess:\/\/install-plugin[^"'<\s]*/.exec(html)?.[0]?.replaceAll("&amp;", "&");
  if (!link) throw new Error("The plugin's page has no gameaccess://install-plugin button.");
  writeFileSync(join(kit, "secret", "plugin-link.txt"), `${link}\n`);
  copied.push("plugin-link.txt (from the plugin's page)");
}

const wsb = `<Configuration>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>${kit}</HostFolder>
      <SandboxFolder>C:\\GA</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <Networking>Enable</Networking>
  <MemoryInMB>8192</MemoryInMB>
  <LogonCommand>
    <Command>powershell -NoProfile -ExecutionPolicy Bypass -File C:\\GA\\mcp\\regress\\sandbox\\in-sandbox.ps1</Command>
  </LogonCommand>
</Configuration>
`;
writeFileSync(join(kit, "gameaccess.wsb"), wsb);
console.log(`Kit: ${kit}`);
console.log(`Installer: ${installer}`);
console.log(`Secret copies: ${copied.length ? copied.join(", ") : "none"} (deleted by the sandbox when it ends)`);
if (!copied.includes("accounts.csv")) console.log("No Steam accounts: games will not start (reported as not ready).");
if (!steamSetup) console.log("No --steam-setup: the sandbox downloads SteamSetup.exe from Steam.");
console.log(`Open ${join(kit, "gameaccess.wsb")} to run the pass.`);
