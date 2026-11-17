import assert from "node:assert/strict";
import { test } from "node:test";
import { clipSnapshot, commandFromUrl, groupCalls, isBackgroundCommand, summarizeArgs, summarizeResult } from "./lib.mjs";

test("reads the command from an IPC URL and ignores any other", () => {
  assert.equal(commandFromUrl("http://ipc.localhost/catalog_cache_query"), "catalog_cache_query");
  assert.equal(commandFromUrl("http://ipc.localhost/plugin%3Aevent%7Clisten"), "plugin:event|listen");
  assert.equal(commandFromUrl("http://127.0.0.1:38148/src/main.tsx"), null);
});

test("logging and event plumbing do not count as something an action did", () => {
  assert.ok(isBackgroundCommand("append_narration_log"));
  assert.ok(isBackgroundCommand("plugin:event|unlisten"));
  assert.ok(!isBackgroundCommand("catalog_cache_query"));
});

test("a catalog answer keeps its total and first games", () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ app_id: index, name: `Game ${index}`, payload: "x".repeat(99) }));
  const summary = summarizeResult({ items, total: 120 });
  assert.equal(summary.total, 120);
  assert.equal(summary.returned, 8);
  assert.deepEqual(summary.first[1], { app_id: 1, name: "Game 1" });
});

test("repeated calls collapse, keeping the last arguments and order", () => {
  const groups = groupCalls([
    { command: "a", args: 1, status: 200 }, { command: "b", args: 2, status: 200 }, { command: "a", args: 3, status: 500 },
  ]);
  assert.deepEqual(groups.map(group => [group.command, group.times, group.args, group.status]), [["a", 2, 3, 500], ["b", 1, 2, 200]]);
});

test("a cut snapshot says it was cut", () => {
  assert.equal(clipSnapshot("short", 100), "short");
  assert.match(clipSnapshot("x".repeat(50), 10), /cut at 10 of 50/);
});

test("long arguments are clipped so one call cannot overflow a report", () => {
  assert.deepEqual(summarizeArgs({ params: { limit: 1 } }), { params: { limit: 1 } });
  const clipped = summarizeArgs({ image: "x".repeat(5_000_000) });
  assert.equal(typeof clipped, "string");
  assert.ok(clipped.length < 1100);
});
