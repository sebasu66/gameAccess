import { describe, expect, it } from "vitest";
import { downloadSteps, formatElapsed, timelineSteps, transferStarted } from "./downloadStepModel";

const states = (steps: ReturnType<typeof downloadSteps>) => steps.map(step => `${step.id}:${step.state}`);

describe("download steps", () => {
  it("uses the launcher's structured steps", () => {
    const steps = downloadSteps({ gameId: 1, phase: "preparing", progress: 0, statusText: "El servicio de aceleración está bajando el juego: 46 %",
      step: { id: "server", detail: "El servicio de aceleración está bajando el juego: 46 %", startedAt: 1000 },
      steps: [{ id: "route", state: "done", result: "El servidor todavía no lo tiene", ms: 1500 }, { id: "probe", state: "done", result: "Lento (0.4 MB/s)", ms: 20000 }] });
    expect(states(steps)).toEqual(["route:done", "probe:done", "server:current", "download:pending", "extract:pending", "install:pending"]);
    expect(steps[2]).toMatchObject({ text: "El servicio de aceleración está bajando el juego: 46 %", startedAt: 1000 });
    expect(steps[1]).toMatchObject({ text: "Lento (0.4 MB/s)", ms: 20000 });
  });

  it("marks the step that was running as failed when the download fails", () => {
    const steps = downloadSteps({ gameId: 1, phase: "error", progress: 0, error: "Sin fuentes", step: { id: "probe", detail: "Midiendo", startedAt: 1 }, steps: [] });
    expect(steps[1]).toMatchObject({ state: "failed", text: "Sin fuentes" });
  });

  it("works the sequence out from an older launcher's texts", () => {
    expect(states(downloadSteps({ gameId: 1, phase: "preparing", progress: 0, statusText: "Paso 1 de 3 · Probando la velocidad del torrent (hasta 20 s)..." })))
      .toEqual(["route:done", "probe:current", "server:pending", "download:pending", "extract:pending", "install:pending"]);
    expect(states(downloadSteps({ gameId: 1, phase: "decompressing", progress: 60, statusText: "Descomprimiendo parte 2 de 4" })))
      .toEqual(["route:skipped", "probe:skipped", "server:skipped", "download:done", "extract:current", "install:pending"]);
  });

  it("formats how long a step has been running", () => {
    expect(formatElapsed(80_000)).toBe("1:20");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });

  it("while preparing shows the running step and the next one, or all of them expanded", () => {
    const preparing = downloadSteps({ gameId: 1, phase: "preparing", progress: 0, step: { id: "probe", detail: "", startedAt: 1 },
      steps: [{ id: "route", state: "done", result: "", ms: 1 }] });
    expect(states(timelineSteps(preparing, false))).toEqual(["probe:current", "server:pending"]);
    expect(states(timelineSteps(preparing, true))).toEqual(states(preparing));
  });

  it("once the download has begun lists only the steps still to come", () => {
    const downloading = downloadSteps({ gameId: 1, phase: "downloading", progress: 40, step: { id: "download", detail: "", startedAt: 2 },
      steps: [{ id: "route", state: "done", result: "", ms: 1 }, { id: "probe", state: "skipped", result: "", ms: 0 }, { id: "server", state: "done", result: "", ms: 5 }] });
    expect(states(timelineSteps(downloading, false))).toEqual(["extract:pending", "install:pending"]);
    expect(states(timelineSteps(downloading, true))).toEqual(["extract:pending", "install:pending"]);
    const extracting = downloadSteps({ gameId: 1, phase: "decompressing", progress: 10, step: { id: "extract", detail: "", startedAt: 3 },
      steps: [{ id: "route", state: "done", result: "", ms: 1 }, { id: "download", state: "done", result: "", ms: 9 }] });
    expect(states(timelineSteps(extracting, false))).toEqual(["install:pending"]);
  });

  it("counts the transfer as started from the download on, and a pause only after bytes arrived", () => {
    expect(transferStarted({ gameId: 1, phase: "preparing", progress: 0 })).toBe(false);
    expect(transferStarted({ gameId: 1, phase: "downloading", progress: 1 })).toBe(true);
    expect(transferStarted({ gameId: 1, phase: "installing", progress: 80 })).toBe(true);
    expect(transferStarted({ gameId: 1, phase: "paused", progress: 0 })).toBe(false);
    expect(transferStarted({ gameId: 1, phase: "paused", progress: 20, bytesDownloaded: 1024 })).toBe(true);
  });
});
