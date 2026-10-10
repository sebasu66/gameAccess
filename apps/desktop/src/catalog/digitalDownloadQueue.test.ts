import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { narrate } from "../narrationLog";
vi.mock("../narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
import { DigitalDownloadService } from "./DigitalDownloadService";
import type { CatalogGame } from "../types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const game = (id: number): CatalogGame => ({ id, app_id: id, name: `Game ${id}`, slug: String(id), credit_cost_per_hour: 0, copies_total: 1, copies_available: 1, downloadSource: "http://localhost/fixture.bin" });
const mock = vi.mocked(invoke);
describe("Digital download scheduling", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", { __TAURI_INTERNALS__: {} }); vi.mocked(narrate).mockClear(); mock.mockReset(); mock.mockResolvedValue({ phase: "downloading" }); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("BASE starts one worker and keeps the remaining downloads in its FIFO list", async () => {
    const service = new DigitalDownloadService(undefined, () => "base");
    await Promise.all([1, 2, 3].map(id => service.start(game(id))));
    expect(mock.mock.calls.filter(call => call[0] === "start_digital_download")).toHaveLength(1);
    expect(service.getDownloads()).toHaveLength(3);
    expect((await service.getStatus(2)).phase).toBe("queued");
    service.updateSnapshot({ gameId: 1, phase: "completed", progress: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.mock.calls.filter(call => call[0] === "start_digital_download")).toHaveLength(2);
    expect((await service.getStatus(3)).phase).toBe("queued");
  });
  it("upgrading admits queued jobs and downgrading preserves running jobs without admitting more", async () => {
    let tier: "base" | "plus" = "base";
    const service = new DigitalDownloadService(undefined, () => tier);
    await Promise.all([1,2,3,4,5,6].map(id => service.start(game(id))));
    tier = "plus"; await service.refreshParallelLimit();
    expect(mock.mock.calls.filter(call => call[0] === "start_digital_download")).toHaveLength(4);
    tier = "base";
    service.updateSnapshot({ gameId: 1, phase: "completed", progress: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect((await service.getStatus(5)).phase).toBe("queued");
  });
  it("runs up to four workers, suppresses duplicates and advances the FIFO queue on completion", async () => {
    const service = new DigitalDownloadService(undefined, () => "plus");
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
    const service = new DigitalDownloadService(undefined, () => "plus");
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
    const service = new DigitalDownloadService(undefined, () => "plus");
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
    const service = new DigitalDownloadService(undefined, () => "plus");
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
  it("clears previous-session finished entries while retaining pending downloads", () => {
    const phases = ["completed", "error", "interrupted", "external", "cancelled", "queued", "paused", "downloading"] as const;
    const storage = new Map([["session-history", JSON.stringify({
      entries: phases.map((phase,i) => ({ game: game(i + 1), snapshot: { gameId: i + 1, phase, progress: 10 } })),
      queue: [6], running: [8],
    })]]);
    vi.stubGlobal("localStorage", { getItem: (key:string) => storage.get(key) ?? null, setItem: (key:string,value:string) => storage.set(key,value) });
    const service = new DigitalDownloadService("session-history");
    expect(service.getDownloads().map(entry => entry.snapshot.phase)).toEqual(["queued", "paused", "downloading"]);
    expect(JSON.parse(storage.get("session-history")!).entries).toHaveLength(3);
  });
  it("dismisses a finished row without uninstalling or invoking worker cancellation", async () => {
    const service = new DigitalDownloadService();
    await service.start(game(1));
    service.updateSnapshot({gameId:1,phase:"completed",progress:100});
    mock.mockClear();
    await service.remove(1);
    expect(service.getDownloads()).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
  });
  it("does not remove an active row when cancellation fails", async () => {
    const service = new DigitalDownloadService(); await service.start(game(1));
    mock.mockRejectedValueOnce(new Error("still running"));
    await expect(service.remove(1)).rejects.toThrow("still running");
    expect(service.getDownloads()).toHaveLength(1);
  });
  it("records only actual speed samples and bounds their lifetime", async () => {
    const service = new DigitalDownloadService(); service.recordFailure(game(1), "fixture");
    service.updateSnapshot({gameId:1,phase:"downloading",progress:1,speedBps:100});
    await vi.advanceTimersByTimeAsync(600);
    service.updateSnapshot({gameId:1,phase:"downloading",progress:2,speedBps:200});
    expect(service.getSpeedSamples(1).map(sample=>sample.speedBps)).toEqual([100,200]);
    service.updateSnapshot({gameId:1,phase:"downloading",progress:3,speedBps:NaN});
    expect(service.getSpeedSamples(1)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(61000);
    service.updateSnapshot({gameId:1,phase:"downloading",progress:4,speedBps:300});
    expect(service.getSpeedSamples(1).map(sample=>sample.speedBps)).toEqual([300]);
  });
  it("refills a cancelled slot without restarting other workers", async () => {
    const service = new DigitalDownloadService(undefined, () => "plus");
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
    const service = new DigitalDownloadService("restore", () => "plus");
    await vi.advanceTimersByTimeAsync(0);
    expect((await service.getStatus(5)).phase).toBe(ids.length === 4 ? "queued" : "preparing");
    await vi.advanceTimersByTimeAsync(1000);
    for (const appId of ids) expect(mock).toHaveBeenCalledWith("digital_download_status", { appId });
  });
  it("reports worker errors through the existing server reporting path without duplicating polls", async () => {
    const service = new DigitalDownloadService(undefined, () => "plus");
    await service.start(game(1));
    const error = { gameId: 1, phase: "error" as const, progress: 0, error: "ninguna contraseña funcionó" };
    service.updateSnapshot(error); service.updateSnapshot(error);
    expect(vi.mocked(narrate).mock.calls.filter(call => call[1]?.level === "ERROR")).toHaveLength(1);
    expect(narrate).toHaveBeenCalledWith("Digital AppID 1 · Game 1 · error: ninguna contraseña funcionó", { area: "DIGITAL_DOWNLOAD", level: "ERROR" });
  });
  it("removes failed downloads when aborted without restarting or cancelling a finished worker", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    const service = new DigitalDownloadService("abort-error");
    service.recordFailure(game(1), "Invalid archive password");
    await service.cancel(1);
    expect(service.getDownloads()).toEqual([]);
    expect(JSON.parse(storage.get("abort-error")!).entries).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
  });
  it("keeps completed when completion races with cancellation", async () => {
    const service = new DigitalDownloadService(undefined, () => "plus"); await service.start(game(1));
    mock.mockResolvedValueOnce({ phase: "completed" });
    await service.cancel(1);
    expect((await service.getStatus(1)).phase).toBe("completed");
  });
  it("retries the selected plugin source without falling back to catalog metadata", async () => {
    const service = new DigitalDownloadService();
    const record = {id:1,name:"Game 1",downloadSource:"https://example.test/selected.zip",installProcess:"",playProcess:"",uninstallProcess:"",auto_installed:false};
    await service.start(game(1), {record});
    service.updateSnapshot({gameId:1,phase:"error",progress:0,error:"network"});
    await service.start(game(1));
    const starts = mock.mock.calls.filter(call => call[0] === "start_digital_download");
    expect(starts).toHaveLength(2);
    expect(starts[1][1]).toMatchObject({downloadSource:record.downloadSource});
  });
  it("logs phase changes and completion once across repeated status polls", async () => {
    const service = new DigitalDownloadService();
    await service.start(game(1));
    const snapshot = {gameId:1,phase:"completed" as const,progress:100,statusText:"ready"};
    service.updateSnapshot(snapshot); service.updateSnapshot(snapshot);
    expect(vi.mocked(narrate).mock.calls.filter(call => call[0].includes("job ended (completed)"))).toHaveLength(1);
    expect(vi.mocked(narrate).mock.calls.filter(call => call[0].includes("-> completed"))).toHaveLength(1);
  });
  it("records a startup error and allows the next queued job to start", async () => {
    const service = new DigitalDownloadService(undefined, () => "plus");
    mock.mockRejectedValueOnce(new Error("cannot spawn"));
    await service.start(game(1)); await service.start(game(2));
    expect((await service.getStatus(1)).phase).toBe("error");
    expect((await service.getStatus(2)).phase).toBe("preparing");
  });
});
