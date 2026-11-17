import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
import { narrate } from "../narrationLog";
import { CentralDialog, centralDialog, SHOW_AFTER_MS, type DialogState } from "./centralDialog";
import { markAnnouncementsSeen, presentAnnouncements, unseenAnnouncements, loadAnnouncements, type AnnouncementEntry } from "./announcements";
import { runAppUpdateTask } from "./updateTask";
import type { AvailableUpdate } from "../appUpdate";

function watch(dialog: CentralDialog) {
  const states: DialogState[] = [];
  dialog.subscribe(state => states.push(state));
  return states;
}

describe("central dialog: tasks", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a quick task never appears; a long one does, with its steps", async () => {
    const dialog = new CentralDialog();
    const states = watch(dialog);
    await dialog.runTask("Quick", [{ id: "a", label: "A", run: async () => undefined }]);
    expect(states.some(state => state.taskVisible)).toBe(false);

    let finish!: () => void;
    const slow = dialog.runTask("Slow", [{ id: "a", label: "A", run: progress => new Promise<void>(resolve => { progress(5, 10, undefined, "bytes"); finish = resolve; }) }]);
    await vi.advanceTimersByTimeAsync(SHOW_AFTER_MS + 10);
    const shown = dialog.snapshot();
    expect(shown.taskVisible).toBe(true);
    expect(shown.task?.steps[0]).toMatchObject({ state: "running", done: 5, total: 10, unit: "bytes" });
    finish();
    await slow;
    expect(dialog.snapshot().task).toBeNull();
  });

  it("the log says how long each step and the whole task took, and whether the player saw the dialog", async () => {
    vi.mocked(narrate).mockClear();
    const dialog = new CentralDialog();
    const task = dialog.runTask("Preparing", [
      { id: "catalog-updates", label: "Catalog news", run: () => new Promise<void>(resolve => setTimeout(resolve, 1500)) },
      { id: "plugin-sources", label: "Plugin sources", run: () => new Promise<"skipped">(resolve => setTimeout(() => resolve("skipped"), 250)) },
      { id: "broken", label: "Broken", run: () => new Promise<void>((_, reject) => setTimeout(() => reject(new Error("offline")), 100)) },
    ]);
    await vi.advanceTimersByTimeAsync(1500 + 250 + 100);
    dialog.answerFailure("continue");
    await task;
    const lines = vi.mocked(narrate).mock.calls.map(([message]) => message);
    expect(lines[0]).toMatch(/^Task "Preparing" started: catalog-updates, plugin-sources, broken/);
    expect(lines).toContain('Step "Catalog news" (catalog-updates) done in 1.50 s.');
    expect(lines).toContain('Step "Plugin sources" (plugin-sources) skipped in 0.25 s.');
    expect(lines).toContain('Step "Broken" (broken) failed in 0.10 s: offline.');
    expect(lines.at(-1)).toMatch(/^Task "Preparing" finished in 1\.85 s; the dialog was shown/);
  });

  it("a quick task logs that the dialog was never shown", async () => {
    vi.mocked(narrate).mockClear();
    await new CentralDialog().runTask("Quick", [{ id: "a", label: "A", run: async () => undefined }]);
    expect(vi.mocked(narrate).mock.calls.at(-1)?.[0]).toMatch(/^Task "Quick" finished in 0\.00 s; the dialog was not shown/);
  });

  it("a failed step does not stop the next ones and waits for the player before closing", async () => {
    const dialog = new CentralDialog();
    const ran: string[] = [];
    const task = dialog.runTask("T", [
      { id: "a", label: "A", run: async () => { throw new Error("sin red"); } },
      { id: "b", label: "B", run: async () => { ran.push("b"); return "skipped"; } },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ran).toEqual(["b"]);
    expect(dialog.snapshot()).toMatchObject({ taskVisible: true, task: { failure: "A: sin red" } });
    expect(dialog.snapshot().task?.steps.map(step => step.state)).toEqual(["failed", "skipped"]);
    dialog.answerFailure("continue");
    await expect(task).resolves.toEqual({ failed: ["A: sin red"] });
    expect(dialog.snapshot().task).toBeNull();
  });

  it("with canRetry the player can run only the failed steps again", async () => {
    const dialog = new CentralDialog();
    let attempts = 0;
    const ran: string[] = [];
    const task = dialog.runTask("T", [
      { id: "a", label: "A", run: async () => { attempts++; if (attempts === 1) throw new Error("vieja"); } },
      { id: "b", label: "B", run: async () => { ran.push("b"); } },
    ], { canRetry: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(dialog.snapshot().task).toMatchObject({ failure: "A: vieja", canRetry: true });
    dialog.answerFailure("retry");
    await expect(task).resolves.toEqual({ failed: [] });
    expect(attempts).toBe(2);
    expect(ran).toEqual(["b"]);
  });

  it("runs tasks one after another", async () => {
    const dialog = new CentralDialog();
    const order: string[] = [];
    let release!: () => void;
    const first = dialog.runTask("1", [{ id: "a", label: "A", run: () => new Promise<void>(resolve => { order.push("1 start"); release = resolve; }) }]);
    const second = dialog.runTask("2", [{ id: "a", label: "A", run: async () => { order.push("2 start"); } }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["1 start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["1 start", "2 start"]);
  });
});

describe("central dialog: announcements", () => {
  const entries: AnnouncementEntry[] = [
    { id: "news-2", date: "2026-11-02", title: { es: "Nueva función", en: "New feature" }, body: { es: "Texto", en: "Text" } },
    { id: "welcome", kind: "welcome", title: { es: "Bienvenido" }, body: { es: "Hola" } },
    { id: "old-only", maxVersion: "0.1.0", title: { es: "Solo viejas" }, body: { es: "x" } },
    { id: "news-1", date: "2026-11-01", title: { es: "Primera" }, body: { es: "y" } },
  ];

  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the welcome first, then news oldest to newest, for this version and language", () => {
    expect(presentAnnouncements(entries, "es", "0.2.0").map(item => item.id)).toEqual(["welcome", "news-1", "news-2"]);
    expect(presentAnnouncements(entries, "en", "0.2.0")[2].title).toBe("New feature");
    expect(presentAnnouncements(entries, "en", "0.2.0")[0].title).toBe("Bienvenido"); // falls back to Spanish
  });

  it("each announcement is shown once", () => {
    expect(unseenAnnouncements(entries, "es", "0.2.0")).toHaveLength(3);
    markAnnouncementsSeen(["welcome", "news-1"]);
    expect(unseenAnnouncements(entries, "es", "0.2.0").map(item => item.id)).toEqual(["news-2"]);
  });

  it("closing the announcements reports which ones were seen", () => {
    const dialog = new CentralDialog();
    const closed = vi.fn();
    dialog.showAnnouncements(presentAnnouncements(entries, "es", "0.2.0"), closed);
    dialog.closeAnnouncements();
    expect(closed).toHaveBeenCalledWith(["welcome", "news-1", "news-2"]);
    expect(dialog.snapshot().announcements).toEqual([]);
  });

  it("the published file wins over the bundled copy, and either can be missing", async () => {
    const files: Record<string, unknown> = {
      "/announcements.json": { announcements: [{ id: "welcome", title: { es: "Vieja" }, body: { es: "a" } }] },
    };
    const fetcher = vi.fn(async (url: string) => {
      if (url.startsWith("https://")) return { ok: true, json: async () => ({ announcements: [{ id: "welcome", title: { es: "Nueva" }, body: { es: "b" } }, { id: "n", title: { es: "N" }, body: { es: "c" } }] }) };
      return { ok: url in files, json: async () => files[url] };
    }) as unknown as typeof fetch;
    const loaded = await loadAnnouncements(fetcher);
    expect(loaded.map(entry => [entry.id, entry.title.es])).toEqual([["welcome", "Nueva"], ["n", "N"]]);
    const offline = vi.fn(async (url: string) => { if (url.startsWith("https://")) throw new Error("offline"); return { ok: true, json: async () => files[url] }; }) as unknown as typeof fetch;
    expect((await loadAnnouncements(offline)).map(entry => entry.title.es)).toEqual(["Vieja"]);
  });
});

describe("central dialog: app update", () => {
  it("shows nothing without an update and reports download and install when there is one", async () => {
    const log = vi.fn();
    await runAppUpdateTask({ check: async () => null, relaunch: vi.fn(), log });
    const relaunch = vi.fn(async () => undefined);
    const update: AvailableUpdate = {
      version: "0.2.0",
      downloadAndInstall: async onEvent => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 100 } });
        onEvent({ event: "Finished" });
      },
    };
    const running = runAppUpdateTask({ check: async () => update, relaunch, log });
    // First the news dialog says a new version was found; nothing downloads until the player closes it.
    await vi.waitFor(() => expect(centralDialog.snapshot().announcements.map(item => item.id)).toEqual(["update-0.2.0"]));
    expect(centralDialog.snapshot().announcements[0].title).toContain("0.2.0");
    expect(relaunch).not.toHaveBeenCalled();
    centralDialog.closeAnnouncements();
    await running;
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("news shown while another announcement is open are added after it, and each caller hears its own close", () => {
    const dialog = new CentralDialog();
    const update = vi.fn(), news = vi.fn();
    dialog.showAnnouncements([{ id: "update-0.2.0", title: "Nueva versión", body: "..." }], update);
    dialog.showAnnouncements([{ id: "news-1", title: "Novedad", body: "..." }], news);
    expect(dialog.snapshot().announcements.map(item => item.id)).toEqual(["update-0.2.0", "news-1"]);
    dialog.closeAnnouncements();
    expect(update).toHaveBeenCalledWith(["update-0.2.0"]);
    expect(news).toHaveBeenCalledWith(["news-1"]);
    expect(dialog.snapshot().announcements).toEqual([]);
  });
});
