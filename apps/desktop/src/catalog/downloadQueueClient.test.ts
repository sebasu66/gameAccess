import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { DownloadQueueClient, QueueRefused } from "./downloadQueueClient";

describe("Download Manager client", () => {
  it("sends orders through the native relay and returns the state", async () => {
    const relay = vi.fn().mockResolvedValue({ status: 200, data: { tier: "base", limit: 1, running: 0, jobs: [] } });
    const client = new DownloadQueueClient(relay);
    await expect(client.state()).resolves.toMatchObject({ limit: 1 });
    await client.move(7, -1);
    expect(relay).toHaveBeenNthCalledWith(1, "/state", undefined);
    expect(relay).toHaveBeenNthCalledWith(2, "/jobs/7/move", { delta: -1 });
  });

  it("turns a refusal into a message for the player and other failures into errors", async () => {
    const refused = new DownloadQueueClient(vi.fn().mockResolvedValue({ status: 409, data: { error: "Solo por torrent." } }));
    await expect(refused.enqueue({ appId: 1, name: "G", source: "https://x" })).rejects.toBeInstanceOf(QueueRefused);
    const broken = new DownloadQueueClient(vi.fn().mockResolvedValue({ status: 500, data: null }));
    await expect(broken.state()).rejects.toThrow("Download Manager: 500");
  });
});
