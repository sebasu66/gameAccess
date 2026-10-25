import { beforeEach, describe, expect, it, vi } from "vitest";

const emitted: Array<(event: { payload: unknown }) => void> = [];
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_name: string, handler: (event: { payload: unknown }) => void) => { emitted.push(handler); return () => emitted.splice(emitted.indexOf(handler), 1); }) }));
vi.mock("../narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../native", () => ({ hasTauriRuntime: () => true }));
const prepare = vi.fn();
vi.mock("../catalogCache", () => ({ prepareCatalogCache: () => prepare() }));
const loadCatalog = vi.fn();
vi.mock("../catalog/DigitalCatalog", () => ({ digitalCatalogService: { loadCatalog: (options: unknown) => loadCatalog(options) } }));
vi.mock("../catalogUpdates", () => ({ recordCatalogSyncTime: vi.fn() }));

import { centralDialog } from "./centralDialog";
import { runCatalogUpdateTask, runStartupPreparation } from "./catalogTask";

const send = (payload: unknown) => emitted.forEach(handler => handler({ payload }));

describe("catalog tasks in the central dialog", () => {
  beforeEach(() => { prepare.mockReset(); loadCatalog.mockReset(); });

  it("shows the bytes downloaded and the games applied while the news are synced", async () => {
    prepare.mockResolvedValue({ installed: false });
    const seen: unknown[] = [];
    const unsubscribe = centralDialog.subscribe(state => {
      const step = state.task?.steps.find(item => item.id === "catalog-updates");
      if (step?.done !== undefined) seen.push([step.unit, step.done, step.total]);
    });
    loadCatalog.mockImplementation(async () => {
      send({ stage: "download", done: 512, total: 2048 });
      send({ stage: "apply", done: 250, total: 300 });
      return { updated: true };
    });
    await runStartupPreparation({ checkUpdates: true });
    unsubscribe();
    expect(seen).toEqual(expect.arrayContaining([["bytes", 512, 2048], ["items", 250, 300]]));
    expect(loadCatalog).toHaveBeenCalledWith({ requireRemote: true });
  });

  it("without a connection the app goes on with the local database; a manual refresh is told", async () => {
    prepare.mockResolvedValue({ installed: true });
    loadCatalog.mockRejectedValue(new Error("offline"));
    await expect(runStartupPreparation({ checkUpdates: true })).resolves.toBeUndefined();
    expect(centralDialog.snapshot().task).toBeNull(); // nothing left waiting for the player
    await expect(runCatalogUpdateTask()).rejects.toThrow("offline");
  });

  it("does not look for news when the last check is recent", async () => {
    prepare.mockResolvedValue({ installed: false });
    await runStartupPreparation({ checkUpdates: false });
    expect(loadCatalog).not.toHaveBeenCalled();
  });
});
