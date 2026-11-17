import type { FreezeJob } from "./freezeJobs";
import { formatBytes } from "./GenericDownloadProgress";
import { useI18n, type TranslationKey } from "./i18n";
import type { FreezeEvent, FreezeProgress } from "./native";
import "./freeze-console.css";

export type Translate = ReturnType<typeof useI18n>["t"];
export const STEP_KEYS: Record<string, TranslationKey> = {
  scan: "freezeStepScan", compress: "freezeStepCompress", verify: "freezeStepVerify", clear: "freezeStepClear",
  decompress: "freezeStepDecompress", extract: "freezeStepExtract", check: "freezeStepCheck",
  move: "freezeStepMove", adopt: "freezeStepAdopt",
};
export const STEPS_OF = { freeze: ["scan", "compress"], deep: ["scan", "compress", "verify", "clear"], thaw: ["decompress"], move: ["move", "clear", "adopt"] } as const;

export const clock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600), minutes = Math.floor((whole % 3600) / 60), rest = whole % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
};

/** One line of the console from a launcher event. */
export function eventText(event: FreezeEvent, job: FreezeJob, t: Translate): string {
  const size = (value: unknown) => formatBytes(Number(value) || 0);
  switch (event.kind) {
    case "start": return t(job.mode === "move" ? "freezeEvStartMove" : job.mode === "thaw" ? "freezeEvStartThaw" : job.mode === "deep" ? "freezeEvStartDeep" : "freezeEvStartFreeze");
    case "renamed": return t("freezeEvRenamed");
    case "resumed": return t("freezeEvResumed", { size: size(event.bytes) });
    case "copied": return t("freezeEvCopied", { size: size(event.bytes), time: clock(Number(event.seconds) || 0) });
    case "leftover": return t("freezeEvLeftover", { folder: String(event.folder ?? "") });
    case "files": return t("freezeEvFiles", { count: String(event.count ?? 0), size: size(event.bytes) });
    case "threads": return t("freezeEvThreads", { count: String(event.count ?? 1) });
    case "step": return `→ ${t(STEP_KEYS[String(event.name)] ?? "freezeStepCompress")}`;
    case "file": return event.stored != null ? t("freezeEvFileStored", { name: String(event.name), size: size(event.bytes), stored: size(event.stored) })
      : t("freezeEvFile", { name: String(event.name), size: size(event.bytes) });
    case "skipped": return t("freezeEvSkipped", { name: String(event.name) });
    case "archived": return t("freezeEvArchived", { size: size(event.bytes) });
    case "verified": return t("freezeEvVerified");
    case "done": return event.moved != null ? t("freezeEvDoneMove", { size: size(event.moved), time: clock(Number(event.seconds) || 0) })
      : event.original != null ? t("freezeEvDone", { original: size(event.original), stored: size(event.stored), time: clock(Number(event.seconds) || 0) })
      : t("freezeEvDoneThaw", { time: clock(Number(event.seconds) || 0) });
    case "failed": return t("freezeEvFailed", { error: String(event.error ?? "") });
    default: return event.kind;
  }
}

/** The picture of the work: files slide into a press and come out as a block of ice that fills up with the progress
 *  (a strapped crate for the deep freeze). A thaw runs the other way. Stands still when done or with reduced motion. */
export function FreezeArt({ mode, percent, state }: { mode: FreezeJob["mode"]; percent: number; state: "working" | "done" | "failed" }) {
  const fill = mode === "thaw" ? 100 - percent : percent;
  const level = 74 - (fill / 100) * 56;
  return (
    <svg className={`gfc-art is-${state}${mode === "thaw" ? " is-thaw" : ""}${mode === "deep" ? " is-deep" : ""}`} viewBox="0 0 300 110" aria-hidden="true">
      <defs>
        <clipPath id="gfc-ice"><rect x="196" y={level} width="84" height="90" /></clipPath>
        <linearGradient id="gfc-frost" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: "var(--ga-frost)", stopOpacity: .95 }} /><stop offset="1" style={{ stopColor: "var(--ga-frost)", stopOpacity: .4 }} /></linearGradient>
      </defs>
      <g className="gfc-flow">
        <path className="gfc-belt" d="M8 86 H150" />
        {[0, 1, 2, 3, 4].map(index => (
          <g key={index} className="gfc-doc" style={{ animationDelay: `${index * -0.56}s` }}>
            <path d="M0 0 H16 L22 6 V30 H0 Z M16 0 V6 H22" />
            <path className="gfc-doc-lines" d="M4 12 H18 M4 17 H18 M4 22 H13" />
          </g>
        ))}
        <g className="gfc-press">
          <rect className="gfc-press-frame" x="128" y="22" width="44" height="72" rx="4" />
          <rect className="gfc-plate gfc-plate-top" x="132" y="26" width="36" height="8" rx="2" />
          <rect className="gfc-plate gfc-plate-bottom" x="132" y="82" width="36" height="8" rx="2" />
          <path className="gfc-belt" d="M172 86 H196" />
        </g>
        <g className="gfc-cube">
          <path className="gfc-cube-back" d="M200 30 L238 16 L276 30 L276 78 L238 94 L200 78 Z" />
          <g clipPath="url(#gfc-ice)">
            <path className="gfc-cube-ice" d="M200 30 L238 44 L238 94 L200 78 Z" />
            <path className="gfc-cube-ice is-side" d="M238 44 L276 30 L276 78 L238 94 Z" />
          </g>
          <path className="gfc-cube-edge" d="M200 30 L238 16 L276 30 L238 44 Z M200 30 V78 L238 94 L276 78 V30 M238 44 V94" />
          {mode === "deep" ? <path className="gfc-strap" d="M219 37 V86 M257 37 V86 M200 54 L238 68 L276 54" /> : null}
          {[[214, 24], [262, 22], [282, 52], [192, 50], [250, 100]].map(([x, y], index) => (
            <path key={index} className="gfc-spark" style={{ animationDelay: `${index * 0.37}s` }} d={`M${x} ${y - 5} V${y + 5} M${x - 5} ${y} H${x + 5} M${x - 3.5} ${y - 3.5} L${x + 3.5} ${y + 3.5} M${x + 3.5} ${y - 3.5} L${x - 3.5} ${y + 3.5}`} />
          ))}
        </g>
      </g>
    </svg>
  );
}

export function stats(progress: FreezeProgress | undefined) {
  if (!progress || progress.finished) return { speed: 0, eta: 0 };
  const elapsed = Math.max(0.5, progress.updated_at - progress.started_at);
  const speed = progress.done_bytes / elapsed;
  const share = progress.percent / 100;
  return { speed, eta: share > 0.02 ? elapsed * (1 - share) / share : 0 };
}
