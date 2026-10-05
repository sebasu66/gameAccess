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
  it("runs one worker, suppresses duplicates and advances the FIFO queue on completion", async () => {
    const service = new DigitalDownloadService();
    await service.start(game(1)); await service.start(game(2)); await service.start(game(2));
    expect(mock.mock.calls.filter(call => call[0] === "start_digital_download")).toHaveLength(1);
    expect((await service.getStatus(2)).phase).toBe("queued");
    service.updateSnapshot({ gameId: 1, phase: "completed", progress: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.mock.calls.filter(call => call[0] === "start_digital_download")).toHaveLength(2);
    expect((await service.getStatus(2)).phase).toBe("preparing");
  });
  it("pauses and cancels queued jobs without touching a worker", async () => {
    const service = new DigitalDownloadService();
    await service.start(game(1)); await service.start(game(2)); await service.start(game(3));
    await service.pause(2); await service.cancel(3);
    expect((await service.getStatus(2)).phase).toBe("paused");
    expect((await service.getStatus(3)).phase).toBe("cancelled");
    expect(mock.mock.calls.filter(call => call[0] !== "start_digital_download")).toHaveLength(0);
    await service.resume(2);
    expect((await service.getStatus(2)).phase).toBe("queued");
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
    await service.start(game(1)); await service.start(game(2));
    service.updateSnapshot({ gameId: 1, phase: "downloading", progress: 40 });
    mock.mockRejectedValueOnce(new Error("worker still running"));
    await expect(service.cancel(1)).rejects.toThrow("worker still running");
    expect((await service.getStatus(1)).phase).toBe("downloading");
    expect((await service.getStatus(2)).phase).toBe("queued");
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
