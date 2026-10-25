import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue({}) }));
vi.mock("../activation", () => ({ getActivationTier: () => "base" }));
vi.mock("../vikingResolver", () => ({ canAccelerate: () => false, buildChunkSession: vi.fn().mockResolvedValue(null) }));
import { DigitalDownloadService } from "./DigitalDownloadService";
import { FakeDownloadQueue } from "./fakeDownloadQueue";
import { parseDownloadSize } from "../downloadSize";
import type { CatalogGame } from "../types";

const MAGNET = "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const game = (id: number): CatalogGame => ({ id, app_id: id, name: `Game ${id}`, downloadSource: MAGNET } as unknown as CatalogGame);

describe("a stopped download goes on from the step it reached", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", { __TAURI_INTERNALS__: {} }); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("shows where a failed download would continue and retries through the Download Manager", async () => {
    const queue = new FakeDownloadQueue();
    const service = new DigitalDownloadService(undefined, () => "base", queue);
    await service.start(game(1));
    queue.set(1, "error", { resumeStep: "extract", errorCode: "no_space" }, { error: "no room", state: "done" });
    await service.sync();
    expect((await service.getStatus(1)).resumeStep).toBe("extract");
    await service.retry(game(1));
    expect(queue.orders.map(order => order.action)).toEqual(["configure", "enqueue", "retry"].filter(action => queue.orders.some(order => order.action === action)));
    expect(queue.orders.filter(order => order.action === "enqueue")).toHaveLength(1);
    expect((await service.getStatus(1)).phase).toBe("queued");
  });

  it("starts over when the Download Manager has nothing to go on with", async () => {
    const queue = new FakeDownloadQueue();
    const service = new DigitalDownloadService(undefined, () => "base", queue);
    await service.retry(game(2));
    expect(queue.orders.map(order => order.action)).toContain("retry");
    expect(queue.orders.filter(order => order.action === "enqueue").map(order => order.appId)).toEqual([2]);
  });
});

describe("sizes written by sources", () => {
  it("are read in bytes for the free-space check", () => {
    expect(parseDownloadSize("12.5 GB")).toBe(Math.round(12.5 * 1024 ** 3));
    expect(parseDownloadSize("850 MB")).toBe(850 * 1024 ** 2);
    expect(parseDownloadSize("1,5 GiB")).toBe(Math.round(1.5 * 1024 ** 3));
    expect(parseDownloadSize("")).toBeUndefined();
    expect(parseDownloadSize("unknown")).toBeUndefined();
  });
});
