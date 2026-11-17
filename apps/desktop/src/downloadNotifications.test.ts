import { afterEach, describe, expect, it, vi } from "vitest";
import { activitySnapshot, clearActivity } from "./activity/activity";
import type { DownloadProgressSnapshot } from "./downloadProvider";
import { downloadNotice, startDownloadNotifications } from "./downloadNotifications";
import { dismissToast, getToasts, notify } from "./toasts";

const feed = vi.hoisted(() => ({ listener: null as null | ((snapshot: unknown) => void) }));
vi.mock("./catalog/DigitalDownloadService", () => ({ digitalDownloadService: {
  getDownloads: () => [{ game: { id: 7, app_id: 7, name: "Alpha" }, snapshot: { gameId: 7, phase: "queued", progress: 0 } }],
  onGlobalUpdate: (listener: (snapshot: unknown) => void) => { feed.listener = listener; return () => { feed.listener = null; }; },
} }));

describe("download notices", () => {
  it("announces a download once it leaves the queue and starts transferring", () => {
    expect(downloadNotice("queued", "downloading")).toEqual({ key: "toastDownloadStarted", tone: "info" });
    expect(downloadNotice("preparing", "downloading")?.key).toBe("toastDownloadStarted");
  });

  it("stays quiet for downloads restored at start-up and for resumed or repeated progress", () => {
    expect(downloadNotice(undefined, "downloading")).toBeNull();
    expect(downloadNotice(undefined, "completed")).toBeNull();
    expect(downloadNotice("paused", "downloading")).toBeNull();
    expect(downloadNotice("downloading", "downloading")).toBeNull();
    expect(downloadNotice("downloading", "decompressing")).toBeNull();
  });

  it("announces the end of a download with a tone that matches the outcome", () => {
    expect(downloadNotice("installing", "completed")).toEqual({ key: "toastDownloadCompleted", tone: "success" });
    expect(downloadNotice("downloading", "error")).toBeNull();
    expect(downloadNotice("downloading", "interrupted")?.tone).toBe("warning");
    expect(downloadNotice("cancelling", "cancelled")?.key).toBe("toastDownloadCancelled");
  });
});

describe("download history", () => {
  it("keeps an interrupted transfer as an important warning in activity", () => {
    clearActivity();
    const stop = startDownloadNotifications();
    feed.listener?.({ gameId: 7, phase: "downloading", progress: 1 });
    feed.listener?.({ gameId: 7, phase: "interrupted", progress: 1 });
    stop();
    expect(activitySnapshot()[0]).toMatchObject({ state: "failed", severity: "warning" });
  });
  it("writes what happened as separate entries: added to the queue, started, then ready or failed", () => {
    clearActivity();
    const stop = startDownloadNotifications();
    // The notifier only knows the downloads it found at start; game 8 is new.
    const send = (gameId: number, phase: DownloadProgressSnapshot["phase"]) => feed.listener?.({ gameId, phase, progress: 0 });
    send(8, "queued");
    send(8, "preparing");
    send(8, "downloading");
    send(8, "completed");
    send(7, "downloading");
    send(7, "error");
    stop();
    const entries = activitySnapshot().filter(entry => entry.key.startsWith("download:")).reverse();
    expect(entries.map(entry => [entry.key.split(":").slice(1, 3).join(":"), entry.state])).toEqual([
      ["8:queued", "info"], ["8:started", "info"], ["8:end", "done"], ["7:started", "info"],
    ]);
    // None of them is a running process: the history shows each one as it happens.
    expect(entries.every(entry => entry.state !== "running")).toBe(true);
  });
});

describe("toast stack", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("stacks messages, refreshes a repeated one and expires them on their own", () => {
    vi.useFakeTimers();
    const read = getToasts;
    const first = notify("Uno", { silent: true, durationMs: 1000 });
    notify("Dos", { silent: true, durationMs: 5000 });
    notify("Uno", { silent: true, durationMs: 1000 });
    expect(read().map(toast => toast.message)).toEqual(["Dos", "Uno"]);
    expect(read().some(toast => toast.id === first)).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(read().map(toast => toast.message)).toEqual(["Dos"]);
    read().forEach(toast => dismissToast(toast.id));
    expect(read()).toEqual([]);
  });
});
