vi.mock("../narrationLog", () => ({ narrate: vi.fn() }));
vi.mock("../settings", () => ({ getApiBaseUrl: vi.fn(async () => "https://api.example") }));
vi.mock("../activation", () => ({ getInstallationId: vi.fn(async () => "11111111-2222-4333-8444-555555555555") }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { applySourceLessons, reportBadSource, syncGameLessons, type GameLesson } from "./gameLessons";
import { sourceFingerprint } from "./sourceFingerprint";

const good = { url: "magnet:?xt=urn:btih:" + "1".repeat(40), sourceName: "Alpha", title: "Good" };
const bad = { url: "magnet:?xt=urn:btih:" + "2".repeat(40), sourceName: "Beta", title: "Not a game" };
const lesson = (subject: string, extra: Partial<GameLesson> = {}): GameLesson => ({ kind: "bad_source", scope: "source", subject, reason: "not_a_game",
  action: "avoid", reports: 2, confidence: "flagged", first_seen: "2026-10-26", last_seen: "2026-10-26", ...extra });

beforeEach(() => { vi.stubGlobal("window", { __TAURI_INTERNALS__: {} }); });
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(invoke).mockReset(); });

describe("what players learned about each game", () => {
  it("moves a marked source to the end, so the first source is never a marked one", async () => {
    const fingerprint = (await sourceFingerprint(bad.url))!;
    const lookup = vi.fn(async () => [lesson(fingerprint), lesson("x", { kind: "how_to_run", scope: "game", action: "note" })]);
    const sources = await applySourceLessons([bad, good], 10, lookup);
    expect(lookup).toHaveBeenCalledWith(10, [fingerprint, await sourceFingerprint(good.url)], ["beta", "alpha"]);
    expect(sources.map(s => s.title)).toEqual(["Good", "Not a game"]);
    expect("lesson" in sources[0]).toBe(false);
    expect(sources[1]).toMatchObject({ fingerprint, lesson: { reason: "not_a_game" } });
  });

  it("marks every source of a provider players learned to avoid, and ignores advice that is not 'avoid'", async () => {
    const goodPrint = (await sourceFingerprint(good.url))!;
    const sources = await applySourceLessons([bad, good], 10, async () => [lesson("beta", { scope: "provider" }), lesson(goodPrint, { action: "note" })]);
    expect(sources.map(s => [s.title, "lesson" in s])).toEqual([["Good", false], ["Not a game", true]]);
  });

  it("keeps a bad source here at once and reports only its fingerprint", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    await reportBadSource({ url: bad.url, reason: "not_a_game", appId: 10, detail: ["audio"] }, fetcher as unknown as typeof fetch);
    const fingerprint = await sourceFingerprint(bad.url);
    expect(invoke).toHaveBeenCalledWith("game_lessons_add_mine", { lesson: expect.objectContaining({ kind: "bad_source", subject: fingerprint, confidence: "mine", app_id: 10 }) });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/game-lessons/report");
    expect(String(init.body)).not.toContain("magnet");
    expect(JSON.parse(String(init.body))).toMatchObject({ kind: "bad_source", scope: "source", subject: fingerprint, reason: "not_a_game", app_id: 10 });
  });

  it("asks the server only for what changed since the local revision", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "game_lessons_revision" ? 42 : { total: 3, work_ms: 1 }) as never);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ revision: 50, full: false, lessons: [lesson("f".repeat(64)), { bogus: true }], removed: [{ kind: "bad_source" }] })));
    await syncGameLessons(fetcher as unknown as typeof fetch);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe("https://api.example/game-lessons?since=42");
    expect(invoke).toHaveBeenCalledWith("game_lessons_apply", { revision: 50, full: false, lessons: [lesson("f".repeat(64))], removed: [{ kind: "bad_source" }] });
  });

  it("keeps the local copy when the server cannot be reached", async () => {
    vi.mocked(invoke).mockImplementation(async () => 7 as never);
    await syncGameLessons((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch);
    expect(invoke).not.toHaveBeenCalledWith("game_lessons_apply", expect.anything());
  });
});
