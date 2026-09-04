import { spawn } from "node:child_process";
import process from "node:process";

const backend = "http://127.0.0.1:38147";
const frontend = "http://127.0.0.1:38148";
const cwd = new URL("..", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");

async function healthy(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

if (!(await healthy(`${backend}/health`))) {
  throw new Error(`GameAccess backend is not healthy at ${backend}`);
}

if (!(await healthy(frontend))) {
  const child = spawn("npm.cmd", ["run", "dev"], {
    cwd,
    env: { ...process.env, VITE_GAMEACCESS_API: backend },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (await healthy(frontend)) {
      ready = true;
      break;
    }
  }
  if (!ready) throw new Error(`GameAccess frontend did not become ready at ${frontend}`);
}

const opener = spawn("cmd.exe", ["/d", "/s", "/c", "start", "", frontend], {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});
opener.unref();

console.log(JSON.stringify({ ok: true, backend, frontend }));
