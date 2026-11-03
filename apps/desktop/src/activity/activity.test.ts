import { beforeEach, describe, expect, it } from "vitest";
import { activitySnapshot, clearActivity, markActivitySeen, MERGE_WINDOW_MS, recordActivity } from "./activity";
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

  it("joins a notice into the last one of its kind: one more line, or the new text in place of the old", () => {
    const at = Date.now();
    recordActivity({ title: "Nuevos juegos para descargar", text: "Ya se pueden descargar 383 juegos más.", tone: "ok", state: "done", kind: "news", merge: "lines" }, at);
    recordActivity({ title: "Nuevos juegos para descargar", text: "Ya se pueden descargar 22 juegos más.", tone: "ok", state: "done", kind: "news", merge: "lines" }, at + 60_000);
    expect(activitySnapshot()).toHaveLength(1);
    expect(activitySnapshot()[0].lines?.map(line => line.text)).toEqual(["Ya se pueden descargar 383 juegos más.", "Ya se pueden descargar 22 juegos más."]);
    recordActivity({ title: "Tu perfil de gustos", text: "Perfil: 0 %.", tone: "info", state: "info", kind: "taste", merge: "replace" }, at + 120_000);
    recordActivity({ title: "Tu perfil de gustos", text: "Perfil: 27 %.", tone: "info", state: "info", kind: "taste", merge: "replace" }, at + 180_000);
    expect(activitySnapshot()).toHaveLength(2);
    expect(activitySnapshot()[0]).toMatchObject({ kind: "taste", text: "Perfil: 27 %." });
    // The news entry is not the newest any more but still recent: a new batch joins it and brings it to the top.
    recordActivity({ title: "Nuevos juegos para descargar", text: "Ya se pueden descargar 5 juegos más.", tone: "ok", state: "done", kind: "news", merge: "lines" }, at + 240_000);
    expect(activitySnapshot().map(entry => entry.kind)).toEqual(["news", "taste"]);
    expect(activitySnapshot()[0].lines).toHaveLength(3);
  });

  it("an old entry of the kind that is not the newest gets a new entry instead", () => {
    const at = Date.now() - 3 * MERGE_WINDOW_MS;
    recordActivity({ title: "Verificación de juegos", text: "65 corren", tone: "ok", state: "done", kind: "verify", merge: "replace" }, at);
    recordActivity({ title: "Otra cosa", tone: "info", state: "info" }, at + 1000);
    recordActivity({ title: "Verificación de juegos", text: "1 corre", tone: "ok", state: "done", kind: "verify", merge: "replace" });
    expect(activitySnapshot().filter(entry => entry.kind === "verify")).toHaveLength(2);
  });
});
