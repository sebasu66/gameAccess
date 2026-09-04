import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const backend = "http://127.0.0.1:38147";
const frontend = "http://127.0.0.1:38148";
const cwd = fileURLToPath(new URL("..", import.meta.url));
const logPath = fileURLToPath(new URL("../tauri-dev.log", import.meta.url));

async function healthy(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

function powershell(script) {
  try {
    return execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "";
  }
}

if (!(await healthy(`${backend}/health`))) {
  throw new Error(`GameAccess backend is not healthy at ${backend}`);
}

// Stop only the previous Vite dev server on GameAccess' dedicated frontend port.
const portPids = powershell("(Get-NetTCPConnection -LocalPort 38148 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ','");
for (const pid of portPids.split(",").map((value) => value.trim()).filter(Boolean)) {
  try { execFileSync("taskkill.exe", ["/PID", pid, "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
}

// Close only a previous GameAccess desktop dev instance, never Steam.
for (const image of ["gameaccess-desktop.exe", "gameAccess.exe"]) {
  try { execFileSync("taskkill.exe", ["/IM", image, "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
}

const log = fs.openSync(logPath, "w");
const child = spawn("cmd.exe", ["/d", "/s", "/c", "npm.cmd run tauri -- dev"], {
  cwd,
  env: { ...process.env, VITE_GAMEACCESS_API: backend },
  detached: true,
  windowsHide: true,
  stdio: ["ignore", log, log],
});
child.unref();

let frontendReady = false;
let desktopRunning = false;
for (let i = 0; i < 180; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  frontendReady ||= await healthy(frontend);
  const tasks = powershell("(Get-Process -Name 'gameaccess-desktop','gameAccess' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','");
  desktopRunning = Boolean(tasks);
  if (frontendReady && desktopRunning) break;
}

if (!frontendReady || !desktopRunning) {
  let tail = "";
  try {
    const text = fs.readFileSync(logPath, "utf8");
    tail = text.slice(-6000);
  } catch {}
  throw new Error(`Tauri app did not become ready. frontendReady=${frontendReady} desktopRunning=${desktopRunning}\n${tail}`);
}

console.log(JSON.stringify({ ok: true, runtime: "tauri", backend, frontend, log: logPath }));
