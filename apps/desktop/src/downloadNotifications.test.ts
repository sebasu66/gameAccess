import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadNotice } from "./downloadNotifications";
import { dismissToast, getToasts, notify } from "./toasts";

vi.mock("./catalog/DigitalDownloadService", () => ({ digitalDownloadService: { getDownloads: () => [], onGlobalUpdate: () => () => undefined } }));

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
    expect(downloadNotice("downloading", "error")).toEqual({ key: "toastDownloadFailed", tone: "error" });
    expect(downloadNotice("downloading", "interrupted")?.tone).toBe("warning");
    expect(downloadNotice("cancelling", "cancelled")?.key).toBe("toastDownloadCancelled");
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
