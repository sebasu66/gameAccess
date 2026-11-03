/**
 * Automated tests through the real protocol: opens the test instance from a client, as an agent would, and runs a
 * script of steps. `npm run smoke -- <steps.mjs>` runs another script; each exports `run(call, log)`.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(process.argv[2] ?? join(here, "steps", "catalog.mjs"));
const client = new Client({ name: "gameaccess-smoke", version: "0.1.0" });
client.onerror = error => console.error("CLIENT ERROR", String(error).slice(0, 1500));
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, "server.mjs")], cwd: here, stderr: "inherit" }));

async function call(name, input = {}) {
  const result = await client.callTool({ name, arguments: input }, undefined, { timeout: 180000 });
  const text = result.content?.find(part => part.type === "text")?.text;
  if (result.isError) throw new Error(`${name}: ${text}`);
  if (!text) return result.content;
  try { return JSON.parse(text); } catch { return text; }
}

let code = 0;
try {
  console.log(await call("ga_start", { fresh: process.env.GA_FRESH === "1" }));
  for (let last = ""; ;) {
    const status = await call("ga_status");
    if (status.phase !== last) console.log("phase:", (last = status.phase));
    if (status.phase === "failed") throw new Error(JSON.stringify(status, null, 1));
    if (status.phase === "ready") break;
    await new Promise(done => setTimeout(done, 2000));
  }
  const { run } = await import(pathToFileURL(script).href);
  await run(call, console.log);
  console.log("PASS");
} catch (error) {
  console.error("FAIL", error);
  code = 1;
} finally {
  await call("ga_stop").catch(() => {});
  await client.close();
}
process.exit(code);
