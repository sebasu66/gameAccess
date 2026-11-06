import { beforeEach, describe, expect, it } from "vitest";
import { activityCategory, activityGroups, activitySnapshot, clearActivity, markActivitySeen, recordActivity } from "./activity";
import { confirmNotice, hideNotice, showNotice } from "../notice/notice";

describe("activity history (docs/GUI_DESIGN.md §4.9)", () => {
  beforeEach(() => { hideNotice(); clearActivity(); });

  it("keeps one entry per process that changes state, with its start and end", () => {
    recordActivity({ key: "download:1", title: "Descargando Hades", tone: "info", state: "running", appId: 1 });
    recordActivity({ key: "download:2", title: "Descargando Celeste", tone: "info", state: "running", appId: 2 });
    recordActivity({ key: "download:1", title: "Hades está listo", tone: "ok", state: "done", appId: 1 });
    const list = activitySnapshot();
    expect(list.filter(entry => entry.key === "download:1")).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: "download:1", state: "done", title: "Hades está listo" });
    expect(list[0].endedAt).toBeGreaterThanOrEqual(list[0].startedAt);
    recordActivity({ key: "download:2", title: "Celeste está listo", tone: "ok", state: "done", appId: 2 });
  });

  it("a question leaves no entry; a plain notice does", () => {
    void confirmNotice({ title: "¿Congelar Hades?", confirmLabel: "Congelar", cancelLabel: "Cancelar" });
    expect(activitySnapshot()).toHaveLength(0);
    showNotice({ title: "Listo", tone: "ok" });
    expect(activitySnapshot()).toHaveLength(1);
    expect(activitySnapshot()[0].state).toBe("done");
  });

  it("opening the panel marks everything seen; clearing keeps what still runs", () => {
    recordActivity({ key: "job:1", title: "Congelando", tone: "frost", state: "running" });
    recordActivity({ title: "Error", tone: "error", state: "failed" });
    markActivitySeen();
    expect(activitySnapshot().every(entry => entry.seen)).toBe(true);
    clearActivity();
    expect(activitySnapshot().map(entry => entry.key)).toEqual(["job:1"]);
    recordActivity({ key: "job:1", title: "Congelado", tone: "frost", state: "done" });
  });

  it("a replacing notice takes the place of the last one of its kind, however old", () => {
    const at = Date.now() - 86_400_000;
    recordActivity({ title: "Verificación de juegos", text: "65 corren", tone: "ok", state: "done", kind: "verify", merge: "replace" }, at);
    recordActivity({ title: "Otra cosa", tone: "info", state: "info" }, at + 1000);
    recordActivity({ title: "Verificación de juegos", text: "1 corre", tone: "ok", state: "done", kind: "verify", merge: "replace" });
    const verify = activitySnapshot().filter(entry => entry.kind === "verify");
    expect(verify).toHaveLength(1);
    expect(verify[0].text).toBe("1 corre");
  });

  it("groups by category at any distance in time, and the group with the newest entry goes last", () => {
    const at = Date.now() - 3 * 86_400_000;
    recordActivity({ title: "Nuevos juegos", text: "383", tone: "ok", state: "done", kind: "news" }, at);
    recordActivity({ key: "job:7", title: "Hades comprimido", tone: "frost", state: "done", appId: 7 }, at + 1000);
    recordActivity({ key: "download:8", title: "Celeste listo", tone: "ok", state: "done", appId: 8 }, at + 2000);
    expect(activityGroups(activitySnapshot()).map(group => group.category)).toEqual(["news", "library", "downloads"]);
    recordActivity({ title: "Nuevos juegos", text: "22", tone: "ok", state: "done", kind: "news" }, at + 86_400_000);
    const groups = activityGroups(activitySnapshot());
    expect(groups.map(group => group.category)).toEqual(["library", "downloads", "news"]);
    expect(groups.at(-1)!.entries.map(entry => entry.text)).toEqual(["383", "22"]);
  });

  it("a process still running is in no group, and a failure stays in its category", () => {
    recordActivity({ key: "download:1", title: "Descargando", tone: "info", state: "running", appId: 1 });
    expect(activityGroups(activitySnapshot())).toHaveLength(0);
    recordActivity({ key: "download:1", title: "Falló", tone: "error", state: "failed", appId: 1 });
    expect(activityGroups(activitySnapshot())[0].category).toBe("downloads");
  });

  it("an entry saved before categories existed finds its group", () => {
    const old = { id: "a", key: "notice:1", title: "x", tone: "info", state: "info", startedAt: 1, seen: true } as const;
    expect(activityCategory({ ...old, kind: "news" })).toBe("news");
    expect(activityCategory({ ...old, appId: 5 })).toBe("library");
    expect(activityCategory(old)).toBe("other");
    expect(activityCategory({ ...old, kind: "task", category: "catalog" })).toBe("catalog");
  });
});
