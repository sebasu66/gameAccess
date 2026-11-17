/** Whether the Steam client is open with a signed-in account: running a game needs it, the game itself does not. */
import { execFile } from "node:child_process";

const run = (file, args) => new Promise(done => execFile(file, args, { windowsHide: true }, (error, stdout) => done(error ? "" : stdout)));

/** Reads `reg query` output: the DWORD a value holds, or null. */
export function registryDword(output, name) {
  const match = new RegExp(String.raw`\s${name}\s+REG_DWORD\s+0x([0-9a-f]+)`, "i").exec(output);
  return match ? parseInt(match[1], 16) : null;
}

/** { running, signed_in, problem }: problem says, without naming any account, what is missing. */
export async function steamStatus() {
  const processes = await run("tasklist", ["/FI", "IMAGENAME eq steam.exe", "/NH"]);
  const running = /steam\.exe/i.test(processes);
  const active = registryDword(await run("reg", ["query", "HKCU\Software\Valve\Steam\ActiveProcess"]), "ActiveUser");
  const signedIn = running && Boolean(active);
  const problem = !running ? "Steam is not running" : !signedIn ? "Steam is running with no account signed in" : null;
  return { running, signed_in: signedIn, problem };
}
