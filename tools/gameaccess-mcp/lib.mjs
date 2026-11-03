/** The parts of the server that need no running app, kept apart so they can be tested. */

/** Calls the page makes on its own, all the time. They say nothing about what an action did. */
const BACKGROUND_COMMANDS = new Set(["append_narration_log", "append_narration_log_batch", "app_frontend_alive"]);

/** The Tauri command an IPC request belongs to, or null when the URL is not an IPC call. */
export function commandFromUrl(url) {
  const match = /^https?:\/\/ipc\.localhost\/([^?#]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isBackgroundCommand(command) {
  return BACKGROUND_COMMANDS.has(command) || command.startsWith("plugin:event|");
}

function clip(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}… (${text.length} chars)` : text;
}

/** A short reading of an answer: lists keep their size and first names, the rest is clipped. */
export function summarizeResult(value, limit = 300) {
  if (value === undefined || value === null) return value ?? null;
  if (Array.isArray(value)) return { count: value.length, first: clip(JSON.stringify(value.slice(0, 3)), limit) };
  if (typeof value === "object" && Array.isArray(value.items)) {
    return {
      total: value.total, returned: value.items.length,
      first: value.items.slice(0, 5).map(item => ({ app_id: item.app_id, name: item.name })),
    };
  }
  return clip(typeof value === "string" ? value : JSON.stringify(value), limit);
}

/**
 * The arguments of a call, kept whole only while short: some commands send megabytes (a picture, a whole list), and one
 * such call made a report larger than what an MCP client accepts in a single message.
 */
export function summarizeArgs(value, limit = 1000) {
  if (value === undefined || value === null) return value ?? null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= limit ? value : clip(text, limit);
}

/** Calls grouped by command in order of first use, each with how many times it ran and its last arguments and answer. */
export function groupCalls(calls) {
  const groups = new Map();
  for (const call of calls) {
    const group = groups.get(call.command);
    if (group) {
      group.times += 1;
      Object.assign(group, { args: call.args, result: call.result, status: call.status });
    } else {
      groups.set(call.command, { command: call.command, times: 1, args: call.args, result: call.result, status: call.status });
    }
  }
  return [...groups.values()];
}

/** Cuts a long snapshot and says how to read the rest, instead of silently losing part of the screen. */
export function clipSnapshot(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… cut at ${maxChars} of ${text.length} chars: pass "root" (a CSS selector) or a larger "max_chars".`;
}

/**
 * How a tool names an element. The snapshot's `ref` is the normal way; the rest let a saved test name an element by
 * what a person sees.
 */
export function toLocator(page, target) {
  const { ref, role, name, text, label, css, exact, nth } = target;
  let locator;
  if (ref) locator = page.locator(`aria-ref=${ref}`);
  else if (role) locator = page.getByRole(role, name === undefined ? {} : { name, exact });
  else if (label) locator = page.getByLabel(label, { exact });
  else if (text) locator = page.getByText(text, { exact });
  else if (css) locator = page.locator(css);
  else throw new Error('Name the element with "ref", "role", "label", "text" or "css".');
  return nth === undefined ? locator : locator.nth(nth);
}
