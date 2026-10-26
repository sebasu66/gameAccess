import type { FreezeMode } from "../FreezeDialog";
import type { FreezeEvent, FreezeProgress } from "../native";

const GB = 1e9;
const FILES = ["Data/textures_01.pak", "Data/textures_02.pak", "Data/audio/music.bank", "Data/levels/world.pak", "Movies/intro.bk2", "Engine/shaders.cache", "Game.exe"];

/** The browser previews have no launcher: a made-up freeze (about 14 s) that writes the same progress the launcher
 *  does, so the console can be seen working. */
export function demoFreeze(mode: FreezeMode, report: (progress: FreezeProgress) => void): Promise<unknown> {
  const action = mode === "thaw" ? "thaw" : mode === "deep" ? "deep" : "freeze";
  const steps = action === "deep" ? [["scan", 1], ["compress", 82], ["verify", 15], ["clear", 2]] as const
    : action === "freeze" ? [["scan", 1], ["compress", 99]] as const : [["decompress", 100]] as const;
  const total = 20.5 * GB, stored = mode === "deep" ? 8.2 * GB : 11.4 * GB, started = Date.now() / 1000;
  const events: FreezeEvent[] = [];
  const event = (kind: string, values: Record<string, unknown> = {}) => events.push({ at: Date.now() / 1000, kind, ...values });
  event("start");
  event("files", { count: 1873, bytes: total });
  event("threads", { count: 20 });
  const duration = 14000;
  return new Promise(resolve => {
    let index = -1;
    const timer = window.setInterval(() => {
      const share = Math.min(1, (Date.now() / 1000 - started) * 1000 / duration);
      let before = 0, step: string = steps[0][0], stepShare = 0;
      for (const [name, weight] of steps) {
        if (share * 100 <= before + weight) { step = name; stepShare = (share * 100 - before) / weight; break; }
        before += weight;
      }
      if (step !== "scan" && !events.some(item => item.kind === "step" && item.name === step)) event("step", { name: step });
      const next = Math.floor(share * FILES.length * 1.4);
      if (next !== index && next < FILES.length && step !== "verify" && step !== "clear") {
        index = next;
        event("file", { name: FILES[index], bytes: (2 + index) * 0.6 * GB, ...(action === "freeze" ? { stored: (2 + index) * 0.33 * GB } : {}) });
      }
      const finished = share >= 1;
      if (finished) event("done", { original: total, stored, seconds: Math.round(duration / 1000) });
      report({ action, steps: steps.map(([name]) => name), step, step_share: stepShare, percent: Math.round(share * 10000) / 100,
        done_bytes: Math.round(total * share), total_bytes: total, file: finished ? "" : FILES[Math.max(0, index)], events: [...events],
        started_at: started, updated_at: Date.now() / 1000, finished, ok: finished ? true : null });
      if (finished) {
        window.clearInterval(timer);
        resolve(mode === "thaw" ? { thawed: true } : { frozen: { stored_bytes: stored, original_bytes: total } });
      }
    }, 250);
  });
}
