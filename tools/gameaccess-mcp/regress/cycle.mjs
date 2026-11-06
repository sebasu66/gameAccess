/**
 * A game's whole life with a fixed game, through the services the interface's buttons call: sources from the plugin,
 * download, install, verification, play, freeze, thaw, verify and play again, uninstall. Each step is checked with
 * what the app answers and what is left on disk, and the machine ends as it was (the game is removed).
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gameStep } from "../page.mjs";
import { steamStatus } from "./steam-status.mjs";

export const CYCLE_GAME = { appId: 105600, name: "Terraria", exe: "Terraria.exe" };
const DOWNLOAD_LIMIT_MS = 45 * 60000;

const sleep = ms => new Promise(done => setTimeout(done, ms));
const run = (file, args) => new Promise(done => execFile(file, args, { windowsHide: true }, (error, stdout) => done(error ? "" : stdout)));
const processRunning = async exe => new RegExp(exe.replace(".", "\\."), "i").test(await run("tasklist", ["/FI", `IMAGENAME eq ${exe}`, "/NH"]));

/** Bytes and files under a folder, to see what an install or a freeze left on disk. */
export function folderSize(folder) {
  let bytes = 0, files = 0;
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else { files += 1; bytes += statSync(full).size; }
    }
  };
  if (existsSync(folder)) walk(folder);
  return { bytes, files };
}

/** The install folder in an answer of the launcher, whatever its name there. */
export function folderOf(answer) {
  for (const key of ["folder", "install_dir", "installDir", "path", "game_dir", "working_dir"]) {
    if (typeof answer?.[key] === "string" && answer[key]) return answer[key];
  }
  return null;
}

export async function runCycle(page, instance, log, game = CYCLE_GAME) {
  const steps = [];
  const step = async (name, action) => {
    const started = Date.now(), from = instance.sequence;
    let ok = false, detail;
    // The first line says what went wrong; the rest is the page's stack.
    try { ({ ok, detail } = await action()); } catch (error) { detail = String(error?.message ?? error).split("\n")[0].replace(/^page\.evaluate: (Error: )?/, ""); }
    const seen = instance.report(from);
    const errors = seen.problems.filter(problem => problem.kind === "page-error" || problem.kind === "console-error").map(problem => problem.text);
    // A game that needs Steam cannot start without a signed-in client: that is the machine not being ready, not the game.
    const blocked = !ok && needsSteam.has(name) ? (await steamStatus()).problem : null;
    const failedLoads = seen.problems.filter(problem => problem.kind === "request-failed").map(problem => `${problem.url} (${problem.error})`);
    steps.push({ step: name, ok, blocked, ms: Date.now() - started, detail, errors, failed_loads: failedLoads, failed_commands: seen.failed_commands });
    log(`${ok ? "ok  " : blocked ? "NOT READY" : "FAIL"} ${name}${detail && typeof detail === "string" ? ` · ${detail}` : ""}${blocked ? ` · ${blocked}` : ""}`);
    return ok;
  };
  const needsSteam = new Set(["play", "play after thaw"]);
  const call = name => page.evaluate(gameStep, { appId: game.appId, step: name });
  let folder = null;

  const playOnce = label => step(label, async () => {
    await call("play");
    for (let waited = 0; waited < 120; waited += 2) {
      if (await processRunning(game.exe)) {
        await sleep(15000); // Long enough to get past the splash.
        const stillUp = await processRunning(game.exe);
        await run("taskkill", ["/IM", game.exe, "/F"]);
        return { ok: stillUp, detail: stillUp ? `${game.exe} ran for 15 s` : `${game.exe} closed on its own within 15 s` };
      }
      await sleep(2000);
    }
    return { ok: false, detail: `${game.exe} did not start within 2 minutes`, launch: await call("launch").catch(() => null) };
  });

  const before = await call("status");
  if (before.installed) {
    steps.push({ step: "preflight", ok: false, detail: `${game.name} is already installed here: the cycle would remove it, so it does not run.` });
    return steps;
  }
  if (!await step("sources from the plugin", async () => {
    const sources = await call("sources");
    return { ok: sources.length > 0, detail: `${sources.length} sources: ${sources.map(source => `${source.source} ${source.size}`).join(", ")}` };
  })) return steps;
  await step("download queue tier", async () => {
    const queue = (await call("queue")).data;
    return { ok: Boolean(queue?.tier), detail: `${queue?.tier}: up to ${queue?.limit} at a time` };
  });
  if (!await step("download and install", async () => {
    await call("download");
    const end = Date.now() + DOWNLOAD_LIMIT_MS;
    let last = "";
    while (Date.now() < end) {
      const status = await call("status");
      const line = `${status.state} ${status.progress ?? ""}`;
      if (line !== last) { log(`     ${line}`); last = line; }
      if (status.installed) return { ok: true, detail: "installed" };
      if (/fail|error|cancel/i.test(status.state)) return { ok: false, detail: `${status.state}: ${status.managed?.error ?? status.repair_warning ?? ""}` };
      await sleep(5000);
    }
    return { ok: false, detail: `not installed after ${DOWNLOAD_LIMIT_MS / 60000} minutes` };
  })) return steps;
  await step("folder on disk", async () => {
    folder = folderOf(await call("process"));
    const size = folder ? folderSize(folder) : { bytes: 0, files: 0 };
    const exe = folder && existsSync(folder) ? readdirSync(folder, { recursive: true }).some(name => String(name).toLowerCase().endsWith(game.exe.toLowerCase())) : false;
    return { ok: Boolean(folder) && size.files > 0 && exe, detail: `${folder ?? "no folder"} · ${size.files} files, ${(size.bytes / 1048576).toFixed(0)} MB${exe ? "" : `, no ${game.exe}`}` };
  });
  const verify = label => step(label, async () => {
    const result = await call("verify");
    return { ok: result?.ok !== false && !result?.error, detail: result?.error ?? result?.message ?? "passed" };
  });
  await verify("verification");
  await playOnce("play");
  await step("freeze", async () => {
    // The files keep their size on disk listings (NTFS compression): the app's own measure says what was saved.
    const outcome = await call("freeze");
    return { ok: Boolean(outcome?.ok), detail: outcome?.detail ?? "" };
  });
  await step("thaw", async () => {
    const outcome = await call("thaw");
    return { ok: Boolean(outcome?.ok), detail: outcome?.detail ?? "" };
  });
  await verify("verification after thaw");
  await playOnce("play after thaw");
  await step("uninstall", async () => {
    const result = await call("uninstall");
    const gone = folder ? !existsSync(folder) || folderSize(folder).files === 0 : true;
    const status = await call("status");
    return { ok: gone && !status.installed, detail: `${result?.folder ?? folder ?? "no folder"} ${gone ? "removed" : "still on disk"}; app says ${status.state}` };
  });
  return steps;
}
