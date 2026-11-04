/**
 * Regression pass, with no agent in the middle: opens the test instance, runs the fixed searches with the app's own
 * code and compares them with Steam's saved answers and with the previous pass, then takes a picture of each screen.
 * Leaves report.json, summary.md and shots/ in a dated folder under runs/, next to the previous passes.
 *
 *   node regress/run.mjs [--no-build] [--only search|screens|cycle] [--cycle] [--installed <exe>] [--activate <file>]
 *
 * --installed drives an app installed from a test build (VITE_GA_TEST=1) instead of this checkout's debug build.
 * --activate loads the PLUS key in that file (its first line) the way the activation screen does, before the rest;
 *   the report says which access the app ended with, never the key.
 * --cycle adds the whole life of a fixed game (cycle.mjs): it downloads about 600 MB through the source plugin.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Instance } from "../instance.mjs";
import { callModule, catalogSearch, explainMissing } from "../page.mjs";
import { compareWithPrevious, compareWithSteam, steamMatches } from "./compare.mjs";
import { steamStatus } from "./steam-status.mjs";
import { runCycle } from "./cycle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = process.env.GA_RUNS ?? join(process.env.LOCALAPPDATA, "GameAccess-MCP", "runs");
mkdirSync(RUNS, { recursive: true });
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
const folder = join(RUNS, stamp);
const shots = join(folder, "shots");
mkdirSync(shots, { recursive: true });
const previous = readdirSync(RUNS).filter(name => name < stamp && existsSync(join(RUNS, name, "report.json"))).sort().at(-1) ?? null;
const before = previous ? JSON.parse(readFileSync(join(RUNS, previous, "report.json"), "utf8")) : null;

const report = { started: new Date().toISOString(), folder, previous, searches: [], screens: [], failures: [] };
const fail = (step, error) => report.failures.push({ step, error: String(error?.message ?? error) });
const installed = args.includes("--installed") ? args[args.indexOf("--installed") + 1] : null;
const instance = new Instance({ exe: installed });
const keyFile = args.includes("--activate") ? args[args.indexOf("--activate") + 1] : null;

/** Redeems the key like the activation screen (activation.ts › redeemActivation) and notes the tier it left. */
async function activate(page) {
  const key = readFileSync(keyFile, "utf8").split(/\r?\n/)[0].trim();
  const tier = () => page.evaluate(callModule, { module: "activation.ts", name: "getActivationTier", args: [] });
  report.access = { before: await tier() };
  try {
    await page.evaluate(callModule, { module: "activation.ts", name: "redeemActivation", args: [key] });
  } catch (error) {
    // The server's answer, not the key: redeemActivation's errors never repeat it.
    report.access.error = String(error?.message ?? error).split("\n")[0];
    fail("activate", report.access.error);
  }
  report.access.after = await tier();
}

async function ready() {
  instance.start({ build: !args.includes("--no-build") });
  while (!["ready", "failed"].includes(instance.phase)) await new Promise(done => setTimeout(done, 1000));
  if (instance.phase === "failed") throw new Error(JSON.stringify(instance.status()));
  const page = instance.requirePage();
  // The frontend's modules answer once the window has drawn its toolbar.
  await page.getByRole("button", { name: "Juegos", exact: true }).first().waitFor({ timeout: 60000 });
  return page;
}

async function searches(page) {
  for (const search of JSON.parse(readFileSync(join(HERE, "searches.json"), "utf8"))) {
    try {
      const saved = join(HERE, "steam", `${search.id}.json`);
      if (!existsSync(saved)) throw new Error(`No saved Steam answer: run node regress/fetch-steam.mjs ${search.id}`);
      const steam = JSON.parse(readFileSync(saved, "utf8"));
      const ours = await page.evaluate(catalogSearch, { query: search.ours.query ?? "", filters: search.ours.filters, limit: 5000 });
      const wanted = steamMatches(steam.games, search);
      const result = compareWithSteam(ours.games, wanted, steam.games, search);
      const missingIds = result.missing.map(game => game.app_id);
      const explained = missingIds.length
        ? await page.evaluate(explainMissing, { query: search.ours.query ?? "", filters: search.ours.filters, appIds: missingIds }) : [];
      const past = before?.searches.find(entry => entry.id === search.id);
      report.searches.push({
        id: search.id, title: search.title, params: ours.params, steam_fetched: steam.fetched,
        counts: { ours: ours.total, steam: wanted.length, common: result.common.length, missing: result.missing.length, extra: result.extra.length },
        missing: explained, extra: result.extra, ours: ours.games.map(game => game.app_id),
        since_previous: past ? compareWithPrevious(past.ours, ours.games) : null,
      });
    } catch (error) {
      fail(`search ${search.id}`, error);
    }
  }
}

/** One picture per screen, reached through the toolbar as a person does; the page's errors are kept per screen. */
const SCREENS = [
  { name: "home", open: page => page.getByRole("button", { name: "Inicio", exact: true }).first().click() },
  { name: "catalog", open: page => page.getByRole("button", { name: "Juegos", exact: true }).first().click() },
  { name: "filters", open: page => page.getByRole("button", { name: "Filtros", exact: true }).first().click(), close: "Escape" },
  { name: "detail", open: page => page.locator("button[aria-label^='Seleccionar'], button[aria-label^='Seleccionado']").first().click(), close: "Escape" },
  // The activity panel stays open beside the other screens until its button is pressed again.
  { name: "activity", open: page => page.getByRole("button", { name: "Actividad", exact: true }).first().click(),
    close: page => page.getByRole("button", { name: "Actividad", exact: true }).first().click() },
  { name: "library-manager", open: page => page.getByRole("button", { name: "Administrar biblioteca", exact: true }).first().click(), close: "Escape" },
  { name: "settings", open: page => page.getByRole("button", { name: "Configuración", exact: true }).first().click(), close: "Escape" },
];

async function screens(page) {
  for (const [index, screen] of SCREENS.entries()) {
    const from = instance.sequence;
    const file = `${String(index + 1).padStart(2, "0")}-${screen.name}.png`;
    try {
      await screen.open(page);
      await instance.settle();
      await page.waitForTimeout(1200); // Entrance animations.
      await page.screenshot({ path: join(shots, file) });
      const seen = instance.report(from);
      report.screens.push({ name: screen.name, shot: `shots/${file}`, problems: seen.problems, failed_commands: seen.failed_commands,
        previous_shot: previous && existsSync(join(RUNS, previous, "shots", file)) ? join(RUNS, previous, "shots", file) : null });
      if (screen.close) {
        await (typeof screen.close === "function" ? screen.close(page) : page.keyboard.press(screen.close));
        await instance.settle();
      }
    } catch (error) {
      fail(`screen ${screen.name}`, error);
      await page.screenshot({ path: join(shots, `${file.replace(".png", "")}-failed.png`) }).catch(() => {});
    }
  }
}

function summary() {
  const steam = report.steam ? (report.steam.problem ? `no listo: ${report.steam.problem}` : "abierto, con sesión") : "sin comprobar";
  const lines = [`# Pasada de regresión ${stamp}`, "", previous ? `Anterior: ${join(RUNS, previous)}` : "Primera pasada.", "", `Steam: ${steam}.`, ""];
  if (report.access) lines.push(`Acceso: ${report.access.before ?? "sin llave"} → ${report.access.after ?? "sin llave"}${report.access.error ? ` (${report.access.error})` : ""}.`, "");
  lines.push("## Búsquedas", "", "| Búsqueda | Nosotros | Steam | En común | Faltan | Sobran | Desde la anterior |", "|---|---|---|---|---|---|---|");
  for (const search of report.searches) {
    const change = search.since_previous ? `+${search.since_previous.added.length} / −${search.since_previous.removed.length}` : "—";
    const c = search.counts;
    lines.push(`| ${search.id} | ${c.ours} | ${c.steam} | ${c.common} | ${c.missing} | ${c.extra} | ${change} |`);
  }
  for (const search of report.searches) {
    const reasons = {};
    for (const game of search.missing) for (const reason of game.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    const extra = {};
    for (const game of search.extra) extra[game.why] = (extra[game.why] ?? 0) + 1;
    lines.push("", `### ${search.title}`, "", `Faltan, por qué: ${Object.entries(reasons).map(([key, n]) => `${key} ${n}`).join(", ") || "ninguno"}.`,
      `Sobran, por qué: ${Object.entries(extra).map(([key, n]) => `${key} ${n}`).join(", ") || "ninguno"}.`);
  }
  lines.push("", "## Pantallas", "");
  for (const screen of report.screens) {
    const issues = screen.problems.filter(problem => problem.kind === "page-error" || problem.kind === "console-error").length;
    lines.push(`- ${screen.name}: ${screen.shot}${issues ? ` · ${issues} errores en consola` : ""}${screen.failed_commands.length ? ` · comandos fallidos: ${screen.failed_commands.join(", ")}` : ""}`);
  }
  if (report.cycle) {
    lines.push("", "## Ciclo de un juego", "", "| Paso | Resultado | Tiempo | Detalle |", "|---|---|---|---|");
    for (const step of report.cycle) {
      const result = step.ok ? "ok" : step.blocked ? `no listo (${step.blocked})` : "FALLA";
      const detail = String(step.detail ?? "").replace(/\|/g, "/").replace(/\s+/g, " ");
      lines.push(`| ${step.step} | ${result} | ${Math.round((step.ms ?? 0) / 1000)} s | ${detail}${step.errors?.length ? ` · ${step.errors.length} errores en consola` : ""}${step.failed_loads?.length ? ` · no cargó: ${[...new Set(step.failed_loads)].join(", ")}` : ""} |`);
    }
  }
  if (report.not_ready?.length) lines.push("", "## No listo (la máquina, no la app)", "", ...report.not_ready.map(item => `- ${item.step}: ${item.why}`));
  lines.push("", "## Fallas", "", ...(report.failures.length ? report.failures.map(item => `- ${item.step}: ${item.error}`) : ["Ninguna."]), "");
  return lines.join("\n");
}

try {
  // Not a failure of the app: the steps that run games report it as their reason.
  report.steam = await steamStatus();
  const page = await ready();
  if (keyFile) await activate(page);
  if (!only || only === "search") await searches(page);
  if (!only || only === "screens") await screens(page);
  if (only === "cycle" || args.includes("--cycle")) {
    report.cycle = await runCycle(page, instance, console.log);
    for (const step of report.cycle.filter(item => !item.ok && !item.blocked)) fail(`cycle ${step.step}`, step.detail);
    report.not_ready = report.cycle.filter(item => item.blocked).map(item => ({ step: `cycle ${item.step}`, why: item.blocked }));
  }
} catch (error) {
  fail("start", error);
} finally {
  report.finished = new Date().toISOString();
  writeFileSync(join(folder, "report.json"), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(join(folder, "summary.md"), summary());
  await instance.stop();
  console.log(summary());
  console.log(`\nReport: ${folder}`);
  process.exit(report.failures.length ? 1 : 0);
}
