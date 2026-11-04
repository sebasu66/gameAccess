import assert from "node:assert/strict";
import { test } from "node:test";
import { compareWithPrevious, compareWithSteam, steamDate, steamMatches } from "./compare.mjs";
import { registryDword } from "./steam-status.mjs";

const NOW = Date.UTC(2026, 10, 3);
const search = { minScore: 70, maxAgeDays: 365 * 5 };

test("reads Steam's release texts", () => {
  assert.equal(steamDate("Mar 3, 2022").getUTCFullYear(), 2022);
  assert.equal(steamDate("3 Mar, 2022").getMonth(), 2);
  assert.equal(steamDate("Coming soon"), null);
  assert.equal(steamDate("Q1 2027"), null);
  assert.equal(steamDate(null), null);
});

test("narrows Steam's results with the search's score and age bars", () => {
  const games = [
    { app_id: 1, score: 90, released: "Jan 1, 2025" },
    { app_id: 2, score: 60, released: "Jan 1, 2025" },
    { app_id: 3, score: null, released: "Jan 1, 2025" },
    { app_id: 4, score: 95, released: "Jan 1, 2015" },
    { app_id: 5, score: 95, released: "Coming soon" },
  ];
  assert.deepEqual(steamMatches(games, search, NOW).map(game => game.app_id), [1]);
});

test("says why we show a game Steam does not", () => {
  const steam = [{ app_id: 1, score: 90, released: "Jan 1, 2025" }, { app_id: 2, score: null, released: "Jan 1, 2025" }];
  const ours = [{ app_id: 1 }, { app_id: 2 }, { app_id: 3 }];
  const result = compareWithSteam(ours, steamMatches(steam, search, NOW), steam, search, NOW);
  assert.deepEqual(result.common.map(game => game.app_id), [1]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.extra.map(game => [game.app_id, game.why]), [[2, "no Steam score (few reviews)"], [3, "not in Steam's results (tag or category)"]]);
});

test("lists what a search gained and lost since the previous pass", () => {
  assert.deepEqual(compareWithPrevious([1, 2], [{ app_id: 2 }, { app_id: 3 }]), { added: [3], removed: [1] });
});

test("reads Steam's signed-in account from the registry", () => {
  const output = ["HKEY_CURRENT_USER\\Software\\Valve\\Steam\\ActiveProcess", "    pid    REG_DWORD    0x64fc", "    ActiveUser    REG_DWORD    0x0", ""].join("\r\n");
  assert.equal(registryDword(output, "ActiveUser"), 0);
  assert.equal(registryDword(output, "pid"), 0x64fc);
  assert.equal(registryDword("", "ActiveUser"), null);
});
