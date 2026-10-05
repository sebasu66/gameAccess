import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DigitalDownloadService } from "./DigitalDownloadService";
import type { CatalogGame } from "../types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const game = (id: number): CatalogGame => ({ id, app_id: id, name: `Game ${id}`, slug: String(id), credit_cost_per_hour: 0, copies_total: 1, copies_available: 1, downloadSource: "http://localhost/fixture.bin" });
const mock = vi.mocked(invoke);
describe("Digital download scheduling", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", { __TAURI_INTERNALS__: {} }); mock.mockReset(); mock.mockResolvedValue({ phase: "downloading" }); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("runs up to four workers, suppresses duplicates and advances the FIFO queue on completion", async () => {
    const service = new DigitalDownloadService();
    await Promise.all([1, 2, 3, 4, 5, 6].map(id => service.start(game(id)))); await service.start(game(5));
    expect(mock.mock.calls.filter(call => call[0] === "start_digital_download")).toHaveLength(4);
    expect((await service.getStatus(5)).phase).toBe("queued");
    service.updateSnapshot({ gameId: 1, phase: "completed", progress: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.mock.calls.filter(call => call[0] === "start_digital_download")).toHaveLength(5);
    expect((await service.getStatus(5)).phase).toBe("preparing");
    expect((await service.getStatus(6)).phase).toBe("queued");
  });
  it("pauses and cancels queued jobs without touching a worker", async () => {
    const service = new DigitalDownloadService();
    await Promise.all([1, 2, 3, 4, 5, 6].map(id => service.start(game(id))));
    await service.pause(5); await service.cancel(6);
    expect((await service.getStatus(5)).phase).toBe("paused");
    expect((await service.getStatus(6)).phase).toBe("cancelled");
    expect(service.getDownloads().map(entry => entry.game.id)).toEqual([1, 2, 3, 4, 5]);
    expect(mock.mock.calls.filter(call => call[0] !== "start_digital_download")).toHaveLength(0);
    await service.resume(5);
    expect((await service.getStatus(5)).phase).toBe("queued");
  });
  it("waits for backend snapshots before showing paused or resumed", async () => {
    const service = new DigitalDownloadService();
    await service.start(game(1));
    service.updateSnapshot({ gameId: 1, phase: "downloading", progress: 30 });
    await service.pause(1);
    expect((await service.getStatus(1)).phase).toBe("downloading");
    service.updateSnapshot({ gameId: 1, phase: "paused", progress: 30 });
    await service.resume(1);
    expect(mock).toHaveBeenCalledWith("control_digital_download", { appId: 1, action: "resume" });
    expect((await service.getStatus(1)).phase).toBe("paused");
  });
  it("does not report cancellation or advance queue when the backend fails", async () => {
    const service = new DigitalDownloadService();
    await Promise.all([1, 2, 3, 4, 5].map(id => service.start(game(id))));
    service.updateSnapshot({ gameId: 1, phase: "downloading", progress: 40 });
    mock.mockRejectedValueOnce(new Error("worker still running"));
    await expect(service.cancel(1)).rejects.toThrow("worker still running");
    expect((await service.getStatus(1)).phase).toBe("downloading");
    expect((await service.getStatus(5)).phase).toBe("queued");
    expect(service.getDownloads()).toHaveLength(5);
  });
  it("removes a confirmed active cancellation before notifying the UI and persists the removal", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const service = new DigitalDownloadService("cancel-test");
    await service.start(game(1)); await service.start(game(2));
    const visibleIds: number[][] = [];
    service.onGlobalUpdate(() => visibleIds.push(service.getDownloads().map(entry => entry.game.id)));
    mock.mockResolvedValueOnce({ phase: "cancelled" });
    await service.cancel(1);
    expect(service.getDownloads().map(entry => entry.game.id)).toEqual([2]);
    expect(visibleIds.at(-1)).toEqual([2]);
    expect(JSON.parse(storage.get("cancel-test")!).entries.map((entry: { game: CatalogGame }) => entry.game.id)).toEqual([2]);
  });
  it("does not restore previously cancelled downloads after reload", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({
      entries: [{ game: game(1), snapshot: { gameId: 1, phase: "cancelled", progress: 0 } }],
      queue: [], running: null,
    }), setItem: vi.fn() });
    expect(new DigitalDownloadService("old-state").getDownloads()).toEqual([]);
  });
  it("refills a cancelled slot without restarting other workers", async () => {
    const service = new DigitalDownloadService();
    await Promise.all([1, 2, 3, 4, 5, 6].map(id => service.start(game(id))));
    mock.mockResolvedValueOnce({ phase: "cancelled" });
    await service.cancel(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getDownloads().map(entry => entry.game.id)).toEqual([1, 3, 4, 5, 6]);
    expect((await service.getStatus(5)).phase).toBe("preparing");
    expect((await service.getStatus(6)).phase).toBe("queued");
    expect(mock.mock.calls.filter(call => call[0] === "start_digital_download").map(call => (call[1] as { appId: number }).appId)).toEqual([1, 2, 3, 4, 5]);
  });
  it.each([{ running: 1 }, { running: [1, 2, 3, 4] }])("restores running workers from saved state $running", async ({ running }) => {
    const ids = Array.isArray(running) ? running : [running];
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({
      entries: [...ids.map(id => ({ game: game(id), snapshot: { gameId: id, phase: "downloading", progress: 10 } })),
        { game: game(5), snapshot: { gameId: 5, phase: "queued", progress: 0 } }],
      queue: [5], running,
    }), setItem: vi.fn() });
    const service = new DigitalDownloadService("restore");
    await vi.advanceTimersByTimeAsync(0);
    expect((await service.getStatus(5)).phase).toBe(ids.length === 4 ? "queued" : "preparing");
    await vi.advanceTimersByTimeAsync(1000);
    for (const appId of ids) expect(mock).toHaveBeenCalledWith("digital_download_status", { appId });
  });
  it("keeps completed when completion races with cancellation", async () => {
    const service = new DigitalDownloadService(); await service.start(game(1));
    mock.mockResolvedValueOnce({ phase: "completed" });
    await service.cancel(1);
    expect((await service.getStatus(1)).phase).toBe("completed");
  });
  it("records a startup error and allows the next queued job to start", async () => {
    const service = new DigitalDownloadService();
    mock.mockRejectedValueOnce(new Error("cannot spawn"));
    await service.start(game(1)); await service.start(game(2));
    expect((await service.getStatus(1)).phase).toBe("error");
    expect((await service.getStatus(2)).phase).toBe("preparing");
  });
});
