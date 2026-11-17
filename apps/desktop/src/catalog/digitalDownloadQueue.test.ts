import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { narrate } from "../narrationLog";
vi.mock("../narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
import { DigitalDownloadService } from "./DigitalDownloadService";
import { FakeDownloadQueue } from "./fakeDownloadQueue";
import type { CatalogGame } from "../types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue({}) }));
vi.mock("../activation", () => ({ getActivationTier: () => "base" }));
vi.mock("../vikingResolver", () => ({ canAccelerate: () => true, buildChunkSession: vi.fn().mockResolvedValue('{"api":"x"}') }));

const MAGNET = "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const game = (id: number, downloadSource = MAGNET): CatalogGame => ({ id, app_id: id, name: `Game ${id}`, slug: String(id), credit_cost_per_hour: 0, copies_total: 1, copies_available: 1, downloadSource } as CatalogGame);

function setup(tier: "base" | "plus" = "base", storageKey?: string) {
  const queue = new FakeDownloadQueue();
  queue.tier = tier;
  const service = new DigitalDownloadService(storageKey, () => tier, queue);
  return { queue, service };
}

// The queue rules (BASE 1 / PLUS 4, pausing frees a place, order, resume after a restart) belong to the launcher's
// Download Manager and are tested there (apps/launcher/tests/test_download_queue.py). These tests cover what the
// interface does: send the orders and show the state the Download Manager answers with.
describe("Digital downloads through the Download Manager", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", { __TAURI_INTERNALS__: {} }); vi.mocked(narrate).mockClear(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("sends every download to the Download Manager, which decides what runs", async () => {
    const { queue, service } = setup("base");
    await Promise.all([1, 2, 3].map(id => service.start(game(id))));
    expect(queue.orders.filter(order => order.action === "enqueue").map(order => order.appId)).toEqual([1, 2, 3]);
    expect(queue.orders.find(order => order.appId === 1)?.body).toMatchObject({ appId: 1, name: "Game 1", source: MAGNET });
    queue.set(1, "downloading", { progressPercent: 20, bytesDownloaded: 10, totalBytes: 50, speedBps: 5, route: "torrent" });
    await service.sync();
    expect((await service.getStatus(1)).phase).toBe("downloading");
    expect((await service.getStatus(2)).phase).toBe("queued");
    expect(service.getDownloadMethod(1)).toBe("torrent");
  });

  it("without a key (free mode) downloads run as BASE: the plan is configured and a paused torrent resumes", async () => {
    const queue = new FakeDownloadQueue();
    queue.tier = null;
    const service = new DigitalDownloadService(undefined, () => null, queue);
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.orders.find(order => order.action === "configure")?.body).toMatchObject({ tier: "base" });
    expect(service.planTier()).toBe("base");
    await service.start(game(1));
    await service.pause(1);
    await service.resume(1);
    expect(queue.orders.map(order => order.action)).toContain("resume");
  });

  it("shows the Download Manager's refusal to the player", async () => {
    const { service } = setup("base");
    await expect(service.start(game(1, "https://host/game.zip"))).rejects.toThrow("solo por torrent");
    const status = await service.getStatus(1);
    expect(status.phase).toBe("error");
    expect(status.statusText).toContain("torrent");
  });

  it("passes pause, resume, move and cancel on and shows the answer", async () => {
    const { queue, service } = setup("base");
    await service.start(game(1)); await service.start(game(2));
    queue.set(1, "downloading");
    await service.sync();
    await service.pause(1);
    expect((await service.getStatus(1)).phase).toBe("paused");
    await service.resume(1);
    expect((await service.getStatus(1)).phase).toBe("queued");
    service.moveInQueue(2, -1);
    await vi.advanceTimersByTimeAsync(0);
    await service.cancel(2);
    expect(queue.orders.map(order => order.action)).toEqual(expect.arrayContaining(["pause", "resume", "move", "cancel"]));
    expect(service.getDownloads().map(entry => entry.game.id)).toEqual([1]); // a cancelled download leaves the list
    expect(queue.orders.some(order => order.action === "remove" && order.appId === 2)).toBe(true);
  });

  it("keeps the queue position the Download Manager reports", async () => {
    const { queue, service } = setup("base");
    await service.start(game(1)); await service.start(game(2));
    queue.set(1, "downloading", {}, { position: -1 }); queue.set(2, "queued", {}, { position: 0 });
    await service.sync();
    expect(service.queuePosition(2)).toBe(0);
    expect(service.queuePosition(1)).toBe(-1);
  });

  it("dismisses a finished row without cancelling it", async () => {
    const { queue, service } = setup("base");
    await service.start(game(1));
    queue.set(1, "completed");
    await service.sync();
    await service.remove(1);
    expect(service.getDownloads()).toHaveLength(0);
    expect(queue.orders.some(order => order.action === "cancel")).toBe(false);
    expect(queue.orders.some(order => order.action === "remove")).toBe(true);
  });

  it("does not remove an active row when cancellation fails", async () => {
    const { queue, service } = setup("base");
    await service.start(game(1));
    queue.set(1, "downloading");
    await service.sync();
    queue.failNext = new Error("worker still running");
    await expect(service.remove(1)).rejects.toThrow("worker still running");
    expect(service.getDownloads()).toHaveLength(1);
  });

  it("asks for the server session only for PLUS and sends it before the order", async () => {
    const { queue, service } = setup("plus");
    await service.start(game(1));
    const actions = queue.orders.map(order => order.action);
    expect(actions.indexOf("configure")).toBeLessThan(actions.indexOf("enqueue"));
    expect(queue.orders.find(order => order.action === "configure")?.body).toMatchObject({ tier: "plus" });
    expect(service.getDownloadMethod(1)).toBe("measuring");
    const base = setup("base");
    await base.service.start(game(2));
    expect(base.queue.orders.some(order => order.action === "configure")).toBe(false);
  });

  it("downloads an abandoned game without the server's acceleration", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "game_lessons_query"
      ? [{ kind: "abandoned", scope: "game", subject: "1", reason: "developer_dropped", action: "discard", app_id: 1 }] : {}) as never);
    const { queue, service } = setup("plus");
    await service.start(game(1));
    expect(queue.orders.some(order => order.action === "configure" && (order.body as { tier?: string })?.tier === "plus")).toBe(false);
    expect(queue.orders.find(order => order.action === "enqueue")?.body).toMatchObject({ appId: 1, delivery: "download" });
    expect(service.getDownloadMethod(1)).not.toBe("measuring");
    vi.mocked(invoke).mockResolvedValue({});
  });

  it("retries the selected plugin source without falling back to catalog metadata", async () => {
    const { queue, service } = setup("base");
    const record = { id: 1, name: "Game 1", downloadSource: "magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", installProcess: "", playProcess: "", uninstallProcess: "", auto_installed: false };
    await service.start(game(1), { record });
    queue.set(1, "error", { error: "network" }, { error: "network" });
    await service.sync();
    queue.jobs.delete(1);
    await service.start(game(1));
    const enqueues = queue.orders.filter(order => order.action === "enqueue");
    expect(enqueues).toHaveLength(2);
    expect(enqueues[1].body).toMatchObject({ source: record.downloadSource });
  });

  it("logs a phase change once however many times the same state is read", async () => {
    const { queue, service } = setup("base");
    await service.start(game(1));
    queue.set(1, "completed");
    for (let i = 0; i < 3; i++) await service.sync();
    const completions = vi.mocked(narrate).mock.calls.filter(call => String(call[0]).includes("-> completed"));
    expect(completions).toHaveLength(1);
  });

  it("marks a restored row the Download Manager no longer has as interrupted", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    storage.set("rows", JSON.stringify({ entries: [{ game: game(9), snapshot: { gameId: 9, phase: "downloading", progress: 40 }, appId: 9 }] }));
    const { service } = setup("base", "rows");
    expect((await service.getStatus(9)).phase).toBe("downloading");
    await service.sync();
    expect((await service.getStatus(9)).phase).toBe("interrupted");
  });

  it("shows downloads the Download Manager resumed after a restart even without saved rows", async () => {
    const { queue, service } = setup("base");
    queue.jobs.set(5, { appId: 5, name: "Restored", phase: "downloading", state: "active", position: -1, error: "", status: { progressPercent: 30 }, route: "torrent" });
    await service.sync();
    expect(service.getDownloads().map(entry => entry.game.name)).toEqual(["Restored"]);
  });

  it("on PLUS end pauses what was running and goes on in free mode (BASE), where a torrent can be resumed", async () => {
    const { queue, service } = setup("base");
    await service.start(game(1)); await service.start(game(2));
    queue.set(1, "downloading");
    await service.sync();
    await service.suspendForAccessEnd();
    expect(queue.orders.filter(order => order.action === "suspend")).toHaveLength(1);
    expect((await service.getStatus(1)).phase).toBe("paused");
    expect((await service.getStatus(2)).phase).toBe("paused");
    expect(queue.orders.at(-1)).toMatchObject({ action: "configure", body: { tier: "base", chunkSession: null } });
    await service.resume(1);
    expect((await service.getStatus(1)).phase).toBe("queued");
  });

  it("records only actual speed samples and bounds their lifetime", async () => {
    const { service } = setup("base");
    service.recordFailure(game(1), "fixture");
    service.updateSnapshot({ gameId: 1, phase: "downloading", progress: 1, speedBps: 100 });
    await vi.advanceTimersByTimeAsync(600);
    service.updateSnapshot({ gameId: 1, phase: "downloading", progress: 2, speedBps: 200 });
    expect(service.getSpeedSamples(1).map(sample => sample.speedBps)).toEqual([100, 200]);
    service.updateSnapshot({ gameId: 1, phase: "downloading", progress: 3, speedBps: NaN });
    expect(service.getSpeedSamples(1)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(61000);
    service.updateSnapshot({ gameId: 1, phase: "downloading", progress: 4, speedBps: 300 });
    expect(service.getSpeedSamples(1).map(sample => sample.speedBps)).toEqual([300]);
  });
});
