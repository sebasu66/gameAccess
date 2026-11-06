/**
 * Downloads for the browser preview (`?uiDemo=1`, dev builds only): one download walks through the steps of a PLUS
 * accelerated download (route, probe, server, download, extract, install) every few seconds, with one game queued and
 * one finished, so the Downloads panel can be seen working without the launcher.
 */
import type { DigitalDownloadService } from "../catalog/DigitalDownloadService";
import type { DownloadProgressSnapshot, DownloadStepDone, DownloadStepId } from "../downloadProvider";
import type { CatalogGame } from "../types";

const game = (id: number, name: string) => ({ id, app_id: id, name } as CatalogGame);
const GB = 1e9;
type Stage = { id: DownloadStepId; phase: DownloadProgressSnapshot["phase"]; detail: string; result: string; seconds: number };
const STAGES: Stage[] = [
  { id: "route", phase: "preparing", detail: "Buscando si el servidor ya tiene el juego", result: "El servidor todavía no lo tiene", seconds: 3 },
  { id: "probe", phase: "preparing", detail: "Midiendo fuentes y velocidad del torrent: 12 fuentes · 0,4 MB/s", result: "Lento (0,4 MB/s): se acelera por el servidor", seconds: 5 },
  { id: "server", phase: "preparing", detail: "El servicio de aceleración de torrents está bajando el juego: 46 % · 38 fuentes · faltan ~6 min", result: "Listo en el servidor", seconds: 6 },
  { id: "download", phase: "downloading", detail: "Descargando pieza 20 de 50 · 4 a la vez", result: "Descargado", seconds: 10 },
  { id: "extract", phase: "decompressing", detail: "Descomprimiendo parte 2 de 4 · 63 %", result: "Descomprimido", seconds: 5 },
  { id: "install", phase: "installing", detail: "Verificando espacio en disco…", result: "Instalado en C:\\Juegos\\ELDEN RING", seconds: 3 },
];

export function demoDownloadService(): DigitalDownloadService {
  const listeners = new Set<(snapshot: DownloadProgressSnapshot) => void>();
  const active = game(1245620, "ELDEN RING"), queued = game(1086940, "Baldur's Gate 3"), finished = game(413150, "Stardew Valley");
  // Downloaded, but the unpacking ran out of disk: it goes on from the unpacking once there is room.
  const stopped = game(1174180, "Red Dead Redemption 2");
  const begun = Date.now();
  const total = STAGES.reduce((sum, stage) => sum + stage.seconds, 0) + 4;
  const snapshotAt = (now: number): DownloadProgressSnapshot => {
    let t = ((now - begun) / 1000) % total;
    const steps: DownloadStepDone[] = [];
    for (const stage of STAGES) {
      if (t < stage.seconds) {
        const progress = (t / stage.seconds) * 100;
        const downloading = stage.id === "download";
        return { gameId: active.id, phase: stage.phase, progress: downloading ? progress / 2 : stage.id === "extract" ? 50 + progress / 2 : 0,
          downloadPercent: downloading ? progress : ["extract", "install"].includes(stage.id) ? 100 : 0, installPercent: stage.id === "extract" ? progress * .8 : stage.id === "install" ? 80 + progress * .2 : 0,
          bytesDownloaded: downloading ? progress / 100 * 49 * GB : 0, bytesTotal: 49 * GB, speedBps: downloading ? 42e6 : 0, etaSeconds: downloading ? (100 - progress) * 12 : 0,
          statusText: stage.detail, step: { id: stage.id, detail: stage.detail, startedAt: now - t * 1000 }, steps };
      }
      t -= stage.seconds;
      steps.push({ id: stage.id, state: "done", result: stage.result, ms: stage.seconds * 1000 });
    }
    return { gameId: active.id, phase: "completed", progress: 100, downloadPercent: 100, installPercent: 100, statusText: "¡ELDEN RING listo para jugar!", step: null, steps };
  };
  window.setInterval(() => { const snapshot = snapshotAt(Date.now()); listeners.forEach(listener => listener(snapshot)); }, 1000);
  const service = {
    getDownloads: () => [
      { game: active, snapshot: snapshotAt(Date.now()) },
      { game: queued, snapshot: { gameId: queued.id, phase: "queued", progress: 0, statusText: "En cola" } as DownloadProgressSnapshot },
      { game: finished, snapshot: { gameId: finished.id, phase: "completed", progress: 100, statusText: "Listo" } as DownloadProgressSnapshot },
      { game: stopped, snapshot: { gameId: stopped.id, phase: "error", progress: 50, downloadPercent: 100, resumeStep: "extract", errorCode: "no_space",
        error: "No hay espacio libre suficiente: hacen falta 128.4 GB libres en la carpeta de juegos y hay 41.0 GB. Liberá espacio y continuá.",
        statusText: "No hay espacio libre suficiente", step: null, steps: [{ id: "download", state: "done", result: "Descargado", ms: 0 }, { id: "extract", state: "failed", result: "Sin espacio", ms: 0 }] } as DownloadProgressSnapshot },
    ],
    onGlobalUpdate: (listener: (snapshot: DownloadProgressSnapshot) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getDownloadMethod: (id: number) => id === active.id ? "accelerated" : undefined,
    planTier: () => "plus",
    queuePosition: (id: number) => id === queued.id ? 0 : -1,
    // While it downloads, the last minute of speed (one sample every 1.5 s, wavering around 42 MB/s) for the charts.
    getSpeedSamples: () => {
      const now = Date.now();
      if (snapshotAt(now).phase !== "downloading") return [];
      return Array.from({ length: 40 }, (_, i) => {
        const time = now - (39 - i) * 1500;
        return { time, speedBps: 42e6 * (.72 + .18 * Math.sin(time / 2300) + .1 * Math.sin(time / 700)) };
      });
    },
    remove: async () => undefined, start: async () => undefined, play: async () => undefined, moveInQueue: () => undefined,
    pause: async () => undefined, resume: async () => undefined, cancel: async () => undefined, retry: async () => undefined,
  };
  return service as unknown as DigitalDownloadService;
}
