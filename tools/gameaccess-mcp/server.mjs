#!/usr/bin/env node
/** MCP server: runs Game Access functions in an isolated test instance with the parameters the interface builds, and reports what they caused. See README.md. */
import { appendFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Instance } from "./instance.mjs";
import { clipSnapshot, toLocator } from "./lib.mjs";
import { callModule, catalogSearch } from "./page.mjs";

const instance = new Instance();
const server = new McpServer({ name: "gameaccess", version: "0.1.0" });

const answer = value => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }] });
const failure = error => ({ isError: true, content: [{ type: "text", text: String(error?.message ?? error) }] });
const tool = (name, description, schema, run) => server.tool(name, description, schema, async input => {
  try {
    return await run(input);
  } catch (error) {
    return failure(error);
  }
});

const target = z.object({
  ref: z.string().optional().describe('Reference from ga_snapshot, e.g. "e12". The normal way to name an element.'),
  role: z.string().optional().describe('ARIA role, e.g. "button"; add "name".'),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  css: z.string().optional(),
  exact: z.boolean().optional(),
  nth: z.number().int().optional().describe("Which match, from 0, when several match."),
}).describe("The element to act on.");

tool("ga_start", "Build and open the isolated test instance. Returns at once: poll ga_status until phase is ready (the first build takes minutes).", {
  fresh: z.boolean().optional().describe("Erase the test profile first: a first run, with no library or favorites."),
  build: z.boolean().optional().describe("false reuses the last build. Default true, which is fast when Rust did not change."),
}, async input => answer(instance.start(input)));

tool("ga_status", "Where the test instance is: stopped, building, starting, ready or failed (with its logs).", {}, async () => answer(instance.status()));

tool("ga_stop", "Close the test instance, and Vite if this server started it. The installed app is never touched.", {}, async () => answer(await instance.stop()));

tool("ga_snapshot", "What is on screen as an accessibility tree, with a ref for each element to pass to the other tools.", {
  root: z.string().optional().describe("CSS selector to read only that part."),
  depth: z.number().int().optional(),
  max_chars: z.number().int().optional().describe("Default 20000."),
}, async ({ root, depth, max_chars = 20000 }) => {
  const page = instance.requirePage();
  const scope = root ? page.locator(root).first() : page;
  return answer(clipSnapshot(await scope.ariaSnapshot({ mode: "ai", depth, timeout: 15000 }), max_chars));
});

tool("ga_screenshot", "Picture of the window, to judge what a tree cannot show.", {}, async () => {
  const data = await instance.requirePage().screenshot({ timeout: 15000 });
  return { content: [{ type: "image", data: data.toString("base64"), mimeType: "image/png" }] };
});

tool("ga_click", "Click an element like a person. Answers with the app commands, errors and navigation it caused.", {
  target,
  button: z.enum(["left", "right", "middle"]).optional(),
  double: z.boolean().optional(),
  at: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional()
    .describe("Where inside the element, as fractions of its box: a slider is set by clicking along its track."),
}, async ({ target: wanted, button, double, at }) => answer(await instance.act(async page => {
  const locator = toLocator(page, wanted);
  if (at) {
    // The pointer goes to that point and clicks whatever is on top there, as a person's click does.
    await locator.scrollIntoViewIfNeeded({ timeout: 10000 });
    const box = await locator.boundingBox({ timeout: 10000 });
    if (!box) throw new Error("The element is not on screen.");
    return page.mouse.click(box.x + box.width * at.x, box.y + box.height * at.y, { button, clickCount: double ? 2 : 1 });
  }
  const options = { button, timeout: 10000 };
  return double ? locator.dblclick(options) : locator.click(options);
})));

const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

tool("ga_drag", "Press, move and release the pointer inside an element, e.g. a slider's thumb along its track. Answers with what it caused.", {
  target,
  from: point.describe("Start, as fractions of the element's box."),
  to: point.describe("End, as fractions of the element's box."),
}, async ({ target: wanted, from, to }) => answer(await instance.act(async page => {
  const locator = toLocator(page, wanted);
  await locator.scrollIntoViewIfNeeded({ timeout: 10000 });
  const box = await locator.boundingBox({ timeout: 10000 });
  if (!box) throw new Error("The element is not on screen.");
  await page.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, { steps: 12 });
  await page.mouse.up();
})));

tool("ga_fill", "Replace the text of a field. Answers with what it caused.", {
  target,
  text: z.string(),
}, async ({ target: wanted, text }) => answer(await instance.act(page => toLocator(page, wanted).fill(text, { timeout: 10000 }))));

tool("ga_press", 'Press a key or combination, e.g. "Enter", "Escape", "Control+A", on the focused element or on "target". Answers with what it caused.', {
  key: z.string(),
  target: target.optional().describe("Focus this element first: a slider takes ArrowLeft, ArrowRight, Home and End."),
  times: z.number().int().min(1).max(100).optional(),
}, async ({ key, target: wanted, times = 1 }) => answer(await instance.act(async page => {
  for (let pressed = 0; pressed < times; pressed += 1) {
    await (wanted ? toLocator(page, wanted).press(key, { timeout: 10000 }) : page.keyboard.press(key));
  }
})));

tool("ga_hover", "Move the pointer over an element. Answers with what it caused.", {
  target,
}, async ({ target: wanted }) => answer(await instance.act(page => toLocator(page, wanted).hover({ timeout: 10000 }))));

tool("ga_scroll", "Scroll the wheel, over an element when given. Answers with what it caused.", {
  target: target.optional(),
  dy: z.number().describe("Pixels: positive goes down."),
}, async ({ target: wanted, dy }) => answer(await instance.act(async page => {
  if (wanted) await toLocator(page, wanted).hover({ timeout: 10000 });
  await page.mouse.wheel(0, dy);
})));

tool("ga_wait", "Wait for text to appear or disappear, for a command to run, or a fixed time. For slow work: downloads, installs.", {
  text: z.string().optional(),
  target: target.optional().describe("Wait for this element instead of a text."),
  gone: z.boolean().optional().describe("With text or target: wait until it is no longer visible."),
  command: z.string().optional().describe("Wait until the app runs this command."),
  ms: z.number().int().optional().describe("Fixed wait, or the limit for the others. Default 30000."),
}, async ({ text, target: wanted, gone, command, ms }) => {
  const page = instance.requirePage();
  const from = instance.sequence;
  const limit = ms ?? 30000;
  const state = gone ? "hidden" : "visible";
  if (wanted) await toLocator(page, wanted).first().waitFor({ state, timeout: limit });
  else if (text) await page.getByText(text).first().waitFor({ state, timeout: limit });
  else if (command) {
    const end = Date.now() + limit;
    while (!instance.events.some(event => event.seq > from && event.command === command)) {
      if (Date.now() > end) throw new Error(`The app did not run ${command} within ${limit} ms.`);
      await new Promise(done => setTimeout(done, 100));
    }
  } else await page.waitForTimeout(limit);
  return answer(instance.report(from));
});

tool("ga_events", "What was recorded since an event number (each action answers with its last_event): commands, errors, navigation.", {
  since: z.number().int().optional(),
  problems_only: z.boolean().optional(),
}, async ({ since = 0, problems_only }) => {
  const report = instance.report(since);
  return answer(problems_only ? { problems: report.problems, last_event: report.last_event } : report);
});

tool("ga_call", "Run any app command (Tauri invoke) in the test instance, with the arguments the frontend sends: the direct way to test a function. Answers with its result and what else it caused.", {
  command: z.string().describe('e.g. "catalog_cache_query", "installed_app_ids", "download_queue_request", "freeze_progress".'),
  args: z.record(z.unknown()).optional(),
}, async ({ command, args }) => {
  let result;
  const report = await instance.act(async page => {
    result = await page.evaluate(([name, values]) => window.__TAURI_INTERNALS__.invoke(name, values), [command, args ?? {}]);
  });
  return answer({ result, caused: report });
});

tool("ga_module", "Call a function exported by the app's own frontend code, loaded from Vite in the running window (same module, same state as the interface): e.g. how the interface builds a query or a taste profile.", {
  module: z.string().describe('Path under apps/desktop/src, e.g. "catalogFilterParams.ts".'),
  export: z.string().describe('Exported name, e.g. "catalogParamsFromFilters". A value that is not a function is returned as is.'),
  args: z.array(z.unknown()).optional().describe("Arguments, as JSON."),
}, async ({ module, export: name, args }) => answer(await instance.requirePage().evaluate(callModule, { module, name, args: args ?? [] })));

tool("ga_catalog_search", "Search the catalog exactly as the catalog screen does: the filters become a query through the interface's own code (genre spellings, parental policy, sort), and the app runs it. Answers with the query sent, the total and the games.", {
  query: z.string().optional().describe("The search box text."),
  filters: z.record(z.unknown()).optional().describe('LibrarySearchFilters (librarySearch.ts), over the defaults: e.g. {"genres":["Racing"],"features":["multiplayer","shared_split_screen"],"minReviewScore":70,"spareUnprovenGames":true,"maxAgeDays":1825}.'),
  initial: z.boolean().optional().describe("Start from the filters the catalog opens with (60 %, unrated kept) instead of none."),
  sort: z.enum(["steam-popularity", "release-date", "steam-review-score", "name"]).optional().describe("Default steam-popularity, as the catalog opens."),
  limit: z.number().int().optional().describe("Games to return, default 1000 like the grid."),
}, async input => answer(await instance.requirePage().evaluate(catalogSearch, input)));

tool("ga_files", "List a folder of the test profile (local, launcher): check what a download or an install left on disk.", {
  path: z.string().optional().describe('Relative to the profile, e.g. "launcher/games".'),
}, async ({ path = "" }) => {
  const folder = instance.profilePath(path);
  return answer(readdirSync(folder).map(name => {
    const info = statSync(join(folder, name));
    return { name, folder: info.isDirectory(), bytes: info.isDirectory() ? undefined : info.size, modified: info.mtime.toISOString() };
  }));
});

const SERVER_LOG = join(process.env.LOCALAPPDATA, "GameAccess-MCP", "server.log");
const note = (kind, detail) => {
  mkdirSync(dirname(SERVER_LOG), { recursive: true });
  appendFileSync(SERVER_LOG, `${new Date().toISOString()} ${kind} ${detail?.stack ?? detail ?? ""}\n`);
};
// Stdout belongs to the protocol. A stray failure inside the driver must not take the whole server down.
for (const kind of ["uncaughtException", "unhandledRejection"]) process.on(kind, error => note(kind, error));
process.on("exit", code => note("exit", code));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { note(signal); instance.stop().finally(() => process.exit(0)); });
process.stdin.on("close", () => { note("stdin-close"); instance.stop().finally(() => process.exit(0)); });

await server.connect(new StdioServerTransport());
