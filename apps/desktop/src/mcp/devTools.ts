/**
 * Developer tools (Settings › AI control › developer tools, off by default): what an AI needs to test Game Access from
 * outside, on the app itself and not on a copy. Any app command, any frontend function, the screen as a list of what
 * can be pressed, pressing and typing like a person, a picture of the window and the page's errors.
 */
import { invoke } from "@tauri-apps/api/core";
import * as DigitalCatalog from "../catalog/DigitalCatalog";
import * as DigitalDownloadService from "../catalog/DigitalDownloadService";
import * as DigitalProcessManager from "../catalog/DigitalProcessManager";
import * as appScreen from "../appScreen";
import * as catalogCache from "../catalogCache";
import * as catalogFilterParams from "../catalogFilterParams";
import * as freezeJobs from "../freezeJobs";
import * as gameArea from "../gameArea";
import * as librarySearch from "../librarySearch";
import * as libraryScan from "../libraryScan";
import * as notice from "../notice/notice";
import * as parentalControl from "../parentalControl";
import * as tasteProfile from "../tasteProfile";
import { num, str, ToolContent, ToolError, type McpTool } from "./tools";

/** The modules an installed app can call (its source is not there to import); in development any path under src. */
const MODULES: Record<string, Record<string, unknown>> = {
  "catalog/DigitalCatalog.ts": DigitalCatalog, "catalog/DigitalDownloadService.ts": DigitalDownloadService,
  "catalog/DigitalProcessManager.ts": DigitalProcessManager, "appScreen.ts": appScreen, "catalogCache.ts": catalogCache,
  "catalogFilterParams.ts": catalogFilterParams, "freezeJobs.ts": freezeJobs, "gameArea.ts": gameArea,
  "librarySearch.ts": librarySearch, "libraryScan.ts": libraryScan, "notice/notice.ts": notice,
  "parentalControl.ts": parentalControl, "tasteProfile.ts": tasteProfile,
};

async function loadModule(path: string): Promise<Record<string, unknown>> {
  if (MODULES[path]) return MODULES[path];
  if (import.meta.env.DEV) return import(/* @vite-ignore */ `/src/${path}`);
  throw new ToolError(`Not callable in an installed app: ${path}. These are: ${Object.keys(MODULES).join(", ")}`);
}

/** Anything to JSON, without failing on cycles, functions or very long answers. */
function plain(value: unknown, limit = 60_000): unknown {
  const seen = new WeakSet();
  const text = JSON.stringify(value, (_key, item) => {
    if (typeof item === "function") return `[function ${item.name || ""}]`;
    if (item instanceof Error) return { error: item.message };
    if (item && typeof item === "object") { if (seen.has(item)) return "[cycle]"; seen.add(item); }
    return item;
  }) ?? "null";
  return text.length > limit ? { truncated: true, text: text.slice(0, limit) } : JSON.parse(text);
}

// ---- What happened: the page's errors and warnings, and the app commands the tools ran ----

interface DevEvent { n: number; at: string; kind: "error" | "warn" | "command" | "navigation"; text: string }
const events: DevEvent[] = [];
let counter = 0;
const record = (kind: DevEvent["kind"], text: string) => {
  events.push({ n: ++counter, at: new Date().toISOString(), kind, text: text.slice(0, 2000) });
  if (events.length > 500) events.shift();
};
let watching = false;

/** From the bridge: keeps the page's errors from now on, so dev_events can tell what an action caused. */
export function startDevEvents(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  const show = (args: unknown[]) => args.map(arg => arg instanceof Error ? arg.message : typeof arg === "string" ? arg : JSON.stringify(plain(arg, 1000))).join(" ");
  for (const kind of ["error", "warn"] as const) {
    const original = console[kind].bind(console);
    console[kind] = (...args: unknown[]) => { record(kind, show(args)); original(...args); };
  }
  window.addEventListener("error", event => record("error", event.message));
  window.addEventListener("unhandledrejection", event => record("error", String((event.reason as Error)?.message ?? event.reason)));
  // Read once the change is done: the event goes out as it starts.
  window.addEventListener(appScreen.SCREEN_CHANGE_EVENT, () => setTimeout(() => record("navigation", `screen ${appScreen.getAppScreen()}`), 0));
}

// ---- The screen, as a person sees it ----

const PRESSABLE = "button, a[href], input, select, textarea, [role=button], [role=tab], [role=menuitem], [role=option], [role=switch], [role=checkbox], [tabindex]:not([tabindex='-1'])";

const visible = (element: Element) => {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && box.bottom > 0 && box.top < innerHeight;
};

const nameOf = (element: Element) => (element.getAttribute("aria-label") || (element as HTMLInputElement).placeholder || element.textContent || element.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 120);

function snapshot() {
  document.querySelectorAll("[data-mcp-ref]").forEach(element => element.removeAttribute("data-mcp-ref"));
  let ref = 0;
  const elements = [...document.querySelectorAll(PRESSABLE)].filter(visible).map(element => {
    const id = `e${++ref}`;
    element.setAttribute("data-mcp-ref", id);
    const input = element as HTMLInputElement;
    return {
      ref: id, role: element.getAttribute("role") || element.tagName.toLowerCase(), name: nameOf(element),
      ...(input.value !== undefined && /input|select|textarea/i.test(element.tagName) ? { value: input.type === "password" ? "•••" : input.value } : {}),
      ...((element as HTMLButtonElement).disabled ? { disabled: true } : {}),
      ...(element.getAttribute("aria-pressed") === "true" || element.getAttribute("aria-selected") === "true" || element.getAttribute("aria-current") ? { selected: true } : {}),
    };
  });
  const current = notice.getNotice();
  return {
    screen: appScreen.getAppScreen(),
    notice: current ? { title: current.title, text: current.text ?? null, actions: current.actions.map(action => action.label) } : null,
    text: (document.querySelector("main, #root") as HTMLElement | null)?.innerText.replace(/\n{3,}/g, "\n\n").slice(0, 4000) ?? "",
    elements,
  };
}

function target(args: Record<string, unknown>): HTMLElement {
  const ref = str(args, "ref");
  const text = str(args, "text");
  if (ref) {
    const element = document.querySelector<HTMLElement>(`[data-mcp-ref="${CSS.escape(ref)}"]`);
    if (!element) throw new ToolError(`No element ${ref}: take a new dev_snapshot (refs change with the screen).`);
    return element;
  }
  if (text) {
    const wanted = text.toLowerCase();
    const found = [...document.querySelectorAll<HTMLElement>(PRESSABLE)].filter(visible);
    const element = found.find(item => nameOf(item).toLowerCase() === wanted) ?? found.find(item => nameOf(item).toLowerCase().includes(wanted));
    if (!element) throw new ToolError(`Nothing to press called "${text}" on screen.`);
    return element;
  }
  throw new ToolError('Give "ref" (from dev_snapshot) or "text"');
}

const settle = () => new Promise(resolve => setTimeout(resolve, 400));
/** What an action left: the screen and the notice afterwards, and the errors it caused. */
async function after(since: number) {
  await settle();
  const view = snapshot();
  return { screen: view.screen, notice: view.notice, events: events.filter(event => event.n > since), last_event: counter };
}

const empty = { type: "object", properties: {}, additionalProperties: false } as const;

export const devTools: McpTool[] = [
  {
    name: "dev_snapshot", title: "Read the screen", developer: true,
    description: "What is on Game Access's screen now: the screen and section, the notice, its text, and every visible thing that can be pressed or filled, each with a ref for dev_click and dev_fill.",
    inputSchema: { ...empty }, annotations: { readOnlyHint: true },
    run: async () => snapshot(),
  },
  {
    name: "dev_screenshot", title: "Picture of the window", developer: true,
    description: "A PNG of Game Access's window as it is now (works while it is covered by other windows).",
    inputSchema: { ...empty }, annotations: { readOnlyHint: true },
    run: async () => new ToolContent([{ type: "image", data: await invoke<string>("mcp_screenshot"), mimeType: "image/png" }]),
  },
  {
    name: "dev_click", title: "Press something", developer: true,
    description: "Press a button, tab or link like a person, by its ref from dev_snapshot or by its visible text. Answers with the screen, the notice and the errors it caused.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, text: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: false },
    run: async args => { const since = counter; const element = target(args); element.scrollIntoView({ block: "center" }); element.click(); return after(since); },
  },
  {
    name: "dev_fill", title: "Type in a field", developer: true,
    description: "Replace the text of a field (by ref or its label/placeholder text) as typing would, then answer with what it caused.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, text: { type: "string", description: "The field, by its text." }, value: { type: "string" } }, required: ["value"], additionalProperties: false },
    annotations: { readOnlyHint: false },
    run: async args => {
      const since = counter;
      const element = target(args) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
      element.focus();
      setter ? setter.call(element, String(args.value ?? "")) : (element.value = String(args.value ?? ""));
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return after(since);
    },
  },
  {
    name: "dev_press", title: "Press a key", developer: true,
    description: 'Press a key ("Escape", "Enter", "ArrowDown", "Tab"...) on the focused element, or on the element given by ref.',
    inputSchema: { type: "object", properties: { key: { type: "string" }, ref: { type: "string" } }, required: ["key"], additionalProperties: false },
    annotations: { readOnlyHint: false },
    run: async args => {
      const since = counter;
      const key = str(args, "key") ?? "";
      const element = str(args, "ref") ? target(args) : (document.activeElement as HTMLElement | null) ?? document.body;
      for (const type of ["keydown", "keyup"]) element.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
      return after(since);
    },
  },
  {
    name: "dev_call", title: "Run an app command", developer: true,
    description: "Run any Game Access app command (Tauri invoke) with the arguments the interface sends, and answer with its result. The direct way to test a backend function.",
    inputSchema: { type: "object", properties: { command: { type: "string" }, args: { type: "object" } }, required: ["command"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run: async args => {
      const command = str(args, "command") ?? "";
      record("command", command);
      try { return { result: plain(await invoke(command, (args.args as Record<string, unknown>) ?? {})) }; }
      catch (failure) { throw new ToolError(`${command} failed: ${failure instanceof Error ? failure.message : String(failure)}`); }
    },
  },
  {
    name: "dev_module", title: "Call a frontend function", developer: true,
    description: "Call a function exported by the interface's code, in the running window (same module and state as the screen), e.g. module \"libraryScan.ts\", name \"libraryScanState\". In an installed app only some modules can be called; the error lists them.",
    inputSchema: { type: "object", properties: { module: { type: "string", description: "Path under src, e.g. catalogCache.ts" }, name: { type: "string" }, args: { type: "array" } }, required: ["module", "name"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run: async args => {
      const loaded = await loadModule(str(args, "module") ?? "");
      const name = str(args, "name") ?? "";
      const exported = loaded[name];
      if (typeof exported !== "function") return { value: plain(exported) };
      return { result: plain(await (exported as (...items: unknown[]) => unknown)(...((args.args as unknown[]) ?? []))) };
    },
  },
  {
    name: "dev_eval", title: "Run JavaScript in the window", developer: true,
    description: "Run JavaScript in Game Access's window (the body of an async function; return a value). For checks no other tool covers: computed styles, sizes, element counts.",
    inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run: async args => {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const body = new Function(`return (async () => { ${str(args, "code") ?? ""} })()`) as () => Promise<unknown>;
      return { result: plain(await body()) };
    },
  },
  {
    name: "dev_events", title: "What happened", developer: true,
    description: "The page's errors and warnings, screen changes and the commands dev_call ran, after an event number (each action answers with its last_event).",
    inputSchema: { type: "object", properties: { since: { type: "number" } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async args => { const since = num(args, "since") ?? 0; return { events: events.filter(event => event.n > since), last_event: counter }; },
  },
];
