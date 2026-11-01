import { beforeEach, describe, expect, it } from "vitest";
import { activitySnapshot, clearActivity, markActivitySeen, recordActivity } from "./activity";
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
});
