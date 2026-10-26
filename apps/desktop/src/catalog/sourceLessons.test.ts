vi.mock("../narrationLog", () => ({ narrate: vi.fn() }));
vi.mock("../settings", () => ({ getApiBaseUrl: vi.fn(async () => "https://api.example") }));
vi.mock("../activation", () => ({ getInstallationId: vi.fn(async () => "11111111-2222-4333-8444-555555555555") }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySourceLessons, knownSourceLessons, refreshSourceLessons, reportSourceLesson, type SourceLesson } from "./sourceLessons";
import { sourceFingerprint } from "./sourceFingerprint";

const good = { url: "magnet:?xt=urn:btih:" + "1".repeat(40), sourceName: "Alpha", title: "Good" };
const bad = { url: "magnet:?xt=urn:btih:" + "2".repeat(40), sourceName: "Beta", title: "Not a game" };
const lesson = (subject: string, extra: Partial<SourceLesson> = {}): SourceLesson => ({ scope: "source", subject, reason: "not_a_game",
  action: "avoid", reports: 2, confidence: "flagged", first_seen: "2026-10-26", last_seen: "2026-10-26", ...extra });

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
});

describe("what players learned about sources", () => {
  it("moves a marked source to the end, so the first source is never a marked one", async () => {
    const fingerprint = (await sourceFingerprint(bad.url))!;
    const sources = await applySourceLessons([bad, good], [lesson(fingerprint)]);
    expect(sources.map(s => s.title)).toEqual(["Good", "Not a game"]);
    expect(sources[0].lesson).toBeUndefined();
    expect(sources[1].lesson?.reason).toBe("not_a_game");
    expect(sources[1].fingerprint).toBe(fingerprint);
  });

  it("marks every source of a provider players learned to avoid, and ignores advice that is not 'avoid'", async () => {
    const sources = await applySourceLessons([bad, good], [lesson(" beta ".trim(), { scope: "provider" }), lesson((await sourceFingerprint(good.url))!, { action: "note" })]);
    expect(sources.map(s => [s.title, Boolean(s.lesson)])).toEqual([["Good", false], ["Not a game", true]]);
  });

  it("reports by fingerprint only and counts the player's own report at once", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    await reportSourceLesson({ url: bad.url, reason: "not_a_game", appId: 10, detail: ["audio"] }, fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/source-lessons/report");
    expect(String(init.body)).not.toContain("magnet");
    expect(JSON.parse(String(init.body))).toMatchObject({ scope: "source", subject: await sourceFingerprint(bad.url), reason: "not_a_game", app_id: 10 });
    const sources = await applySourceLessons([bad, good]);
    expect(sources[1]).toMatchObject({ title: "Not a game", lesson: { confidence: "mine" } });
  });

  it("keeps the published list here and asks only for changes", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ revision: "r1", lessons: [lesson("f".repeat(64)), { bogus: true }] }), { status: 200 }));
    await refreshSourceLessons(true, fetcher as unknown as typeof fetch);
    expect(knownSourceLessons().map(l => l.subject)).toEqual(["f".repeat(64)]);
    // Fresh copy: no request until it is 6 hours old.
    await refreshSourceLessons(false, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ revision: "r1", unchanged: true }), { status: 200 }));
    await refreshSourceLessons(true, fetcher as unknown as typeof fetch);
    expect(String((fetcher.mock.calls[1] as unknown[])[0])).toBe("https://api.example/source-lessons?since=r1");
    expect(knownSourceLessons()).toHaveLength(1);
  });

  it("keeps the last list when the server cannot be reached", async () => {
    await refreshSourceLessons(true, (async () => new Response(JSON.stringify({ revision: "r1", lessons: [lesson("e".repeat(64))] }))) as unknown as typeof fetch);
    await refreshSourceLessons(true, (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch);
    expect(knownSourceLessons()).toHaveLength(1);
  });
});
