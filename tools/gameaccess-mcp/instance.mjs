/**
 * The test instance: a debug build of Game Access with its own data, beside whatever the user has open.
 *
 * Nothing here attaches to the installed app. The debugging port exists only on the process started here (WebView2
 * reads it from the environment), and GAMEACCESS_TEST_INSTANCE makes main.rs leave the single instance, gameaccess://
 * and updates to the installed app. The build has no custom-protocol feature, so it loads the current source from Vite
 * instead of the frontend embedded at some earlier compile.
 */
import { spawn, execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { commandFromUrl, groupCalls, isBackgroundCommand, summarizeArgs, summarizeResult } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, "../../apps/desktop");
const TAURI = join(DESKTOP, "src-tauri");
const TARGET = join(TAURI, "target", "mcp");
const EXE = join(TARGET, "debug", "gameaccess-desktop.exe");
const VITE_URL = "http://127.0.0.1:38148/";
const PROFILE = join(process.env.LOCALAPPDATA, "GameAccess-MCP", "profile");
const BUILD_LOG = join(dirname(PROFILE), "build.log");
const APP_LOG = join(dirname(PROFILE), "app.log");
const MAX_EVENTS = 5000;
const QUIET_MS = 400;
const SETTLE_MS = 5000;

const sleep = ms => new Promise(done => setTimeout(done, ms));

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

async function viteAnswers() {
  try {
    return (await fetch(`${VITE_URL}src/main.tsx`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

function killTree(pid) {
  return new Promise(done => execFile("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true }, () => done()));
}

function tail(path, lines = 25) {
  return existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).slice(-lines).join("\n") : "";
}

export class Instance {
  /**
   * With no options, the debug build of this checkout with its own profile, loading the frontend from Vite. With
   * `exe`, an app installed as a person installs it (a test build, inside Windows Sandbox): no build, no Vite, its
   * normal data folders.
   */
  constructor({ exe = null } = {}) {
    this.installedExe = exe;
  }

  phase = "stopped";
  error = null;
  events = [];
  sequence = 0;
  pending = 0;
  lastCallAt = 0;
  startedVite = null;

  status() {
    const status = { phase: this.phase, profile: PROFILE, url: this.page?.url() ?? null, pid: this.app?.pid ?? null };
    if (this.phase === "building") status.build_log = tail(BUILD_LOG, 3);
    if (this.phase === "failed") Object.assign(status, { error: this.error, build_log: tail(BUILD_LOG), app_log: tail(APP_LOG) });
    return status;
  }

  /** Runs in the background: the first build takes minutes, longer than a tool call may last. */
  start({ fresh = false, build = true } = {}) {
    if (!["stopped", "failed"].includes(this.phase)) return this.status();
    this.error = null;
    this.phase = "preparing";
    this.bringUp({ fresh, build }).catch(async error => {
      this.error = error.message;
      await this.closeProcesses();
      this.phase = "failed";
    });
    return this.status();
  }

  async bringUp({ fresh, build }) {
    const installed = Boolean(this.installedExe);
    if (fresh && !installed) rmSync(PROFILE, { recursive: true, force: true });
    mkdirSync(dirname(APP_LOG), { recursive: true });
    if (!installed) for (const folder of ["local", "webview", "launcher"]) mkdirSync(join(PROFILE, folder), { recursive: true });
    if (!installed && (build || !existsSync(EXE))) {
      this.phase = "building";
      await this.build();
    }
    this.phase = "starting";
    if (!installed) await this.ensureVite();
    const port = await freePort();
    // The debugging port is read by WebView2 from the environment of this one process.
    const debug = { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
    this.app = spawn(this.installedExe ?? EXE, [], {
      cwd: installed ? dirname(this.installedExe) : TAURI, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: installed ? { ...process.env, ...debug } : {
        ...process.env, ...debug,
        GAMEACCESS_TEST_INSTANCE: "1",
        LOCALAPPDATA: join(PROFILE, "local"),
        GAMEACCESS_LAUNCHER_DATA: join(PROFILE, "launcher"),
        WEBVIEW2_USER_DATA_FOLDER: join(PROFILE, "webview"),
      },
    });
    const log = createWriteStream(APP_LOG);
    this.app.stdout.pipe(log);
    this.app.stderr.pipe(log);
    this.app.once("exit", code => {
      if (this.phase === "ready" || this.phase === "starting") {
        this.error = `The app exited on its own (code ${code}).`;
        this.phase = "failed";
      }
      this.app = null;
    });
    await this.attach(port);
    this.phase = "ready";
  }

  build() {
    return new Promise((done, fail) => {
      const log = createWriteStream(BUILD_LOG);
      const cargo = spawn("cargo", ["build", "--bin", "gameaccess-desktop", "--no-default-features"], {
        cwd: TAURI, windowsHide: true, env: { ...process.env, CARGO_TARGET_DIR: TARGET }, stdio: ["ignore", "pipe", "pipe"],
      });
      cargo.stdout.pipe(log);
      cargo.stderr.pipe(log);
      cargo.once("error", fail);
      cargo.once("exit", code => (code === 0 ? done() : fail(new Error(`cargo build failed with code ${code}`))));
    });
  }

  async ensureVite() {
    if (await viteAnswers()) return;
    this.startedVite = spawn("npm", ["run", "dev"], { cwd: DESKTOP, shell: true, windowsHide: true, stdio: "ignore" });
    for (let waited = 0; waited < 60; waited += 1) {
      if (await viteAnswers()) return;
      await sleep(1000);
    }
    throw new Error("Vite did not answer on port 38148.");
  }

  async attach(port) {
    for (let waited = 0; waited < 90 && !this.browser; waited += 1) {
      if (!this.app) throw new Error(this.error ?? "The app closed before it could be reached.");
      try {
        this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      } catch {
        await sleep(1000);
      }
    }
    if (!this.browser) throw new Error("The app's window never opened its debugging port.");
    const context = this.browser.contexts()[0];
    this.page = context.pages()[0] ?? await context.waitForEvent("page");
    this.watch(this.page);
    await this.page.waitForLoadState("load");
  }

  /** Everything that happens from here on is recorded, so an action can report what it caused. */
  watch(page) {
    const record = event => {
      this.events.push({ seq: ++this.sequence, at: new Date().toISOString(), ...event });
      if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    };
    page.on("console", message => {
      if (["error", "warning"].includes(message.type())) record({ kind: `console-${message.type()}`, text: message.text().slice(0, 1000) });
    });
    page.on("pageerror", error => record({ kind: "page-error", text: String(error.stack ?? error).slice(0, 2000) }));
    page.on("framenavigated", frame => {
      if (frame === page.mainFrame()) record({ kind: "navigation", url: frame.url() });
    });
    const started = request => {
      const command = commandFromUrl(request.url());
      if (!command || request.method() === "OPTIONS" || isBackgroundCommand(command)) return;
      this.pending += 1;
      this.lastCallAt = Date.now();
      return command;
    };
    page.on("request", started);
    const finished = async (request, response) => {
      const command = commandFromUrl(request.url());
      if (!command || request.method() === "OPTIONS" || isBackgroundCommand(command)) return;
      this.pending = Math.max(0, this.pending - 1);
      this.lastCallAt = Date.now();
      let args = null;
      try { args = request.postDataJSON(); } catch { args = request.postData(); }
      args = summarizeArgs(args);
      let result = null;
      try { result = summarizeResult(await response?.json()); } catch { /* A binary or unread answer is still a call. */ }
      record({ kind: "ipc", command, args, status: response?.status() ?? null, result });
    };
    page.on("requestfinished", async request => finished(request, await request.response().catch(() => null)));
    page.on("requestfailed", request => {
      // A console "Failed to load resource" does not say what failed to load: the address does.
      if (!commandFromUrl(request.url())) record({ kind: "request-failed", url: request.url().slice(0, 300), error: request.failure()?.errorText ?? null });
      return finished(request, null);
    });
  }

  /** Waits until the page stops asking the app for things, with a cap because some screens poll forever. */
  async settle() {
    const started = Date.now();
    await sleep(QUIET_MS);
    while (Date.now() - started < SETTLE_MS && (this.pending > 0 || Date.now() - this.lastCallAt < QUIET_MS)) await sleep(50);
    await sleep(100); // The answers above are read asynchronously.
  }

  /** Runs one action and answers with what it caused: the app's commands, errors and any navigation. */
  async act(action) {
    const page = this.requirePage();
    const from = this.sequence;
    await action(page);
    await this.settle();
    return this.report(from);
  }

  report(from) {
    const events = this.events.filter(event => event.seq > from);
    const problems = events.filter(event => event.kind !== "ipc" && event.kind !== "navigation");
    return {
      commands: groupCalls(events.filter(event => event.kind === "ipc")),
      problems,
      navigations: events.filter(event => event.kind === "navigation").map(event => event.url),
      failed_commands: events.filter(event => event.kind === "ipc" && event.status !== null && event.status >= 400).map(event => event.command),
      last_event: this.sequence,
    };
  }

  requirePage() {
    if (this.phase !== "ready" || !this.page) throw new Error(`The test instance is not ready (${this.phase}). Call ga_start and check ga_status.`);
    return this.page;
  }

  async closeProcesses() {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
    if (this.app) await killTree(this.app.pid);
    this.app = null;
    if (this.startedVite) await killTree(this.startedVite.pid);
    this.startedVite = null;
  }

  async stop() {
    this.phase = "stopping";
    await this.closeProcesses();
    this.phase = "stopped";
    return this.status();
  }

  /** Lists what the test instance wrote under its profile: where a download or install can be checked. */
  profilePath(relative = "") {
    const path = resolve(PROFILE, relative);
    if (path !== PROFILE && !path.startsWith(`${PROFILE}\\`)) throw new Error("That path is outside the test profile.");
    return path;
  }
}
