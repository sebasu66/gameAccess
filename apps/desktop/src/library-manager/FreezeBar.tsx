import { useEffect, useRef } from "react";
import type { FreezeMode } from "../FreezeDialog";
import { formatBytes } from "../GenericDownloadProgress";
import { useI18n } from "../i18n";

type State = "working" | "done" | "failed";

// The game as a grid of cubes: 4 rows of 9 big ones fill the bar; frozen, the same cubes are smaller and packed into
// 5 rows from the left, about half the room. Positions in px inside the cube area (13rem high, 12 px padding).
const BIG = 40, BIG_GAP = 6, BIG_ROWS = 4, COLS = 9;
const SMALL = 29, SMALL_GAP = 6, SMALL_ROWS = 5;
const COUNT = BIG_ROWS * COLS;
const big = (index: number) => ({ x: Math.floor(index / BIG_ROWS) * (BIG + BIG_GAP), y: (index % BIG_ROWS) * (BIG + BIG_GAP) + 3, scale: 1 });
const small = (index: number) => ({ x: Math.floor(index / SMALL_ROWS) * (SMALL + SMALL_GAP), y: (index % SMALL_ROWS) * (SMALL + SMALL_GAP), scale: SMALL / BIG });

/**
 * A freeze beside the game's log: a bar as high as the log, the size of the game's landscape picture, which sits in
 * it faint and half desaturated (it never changes size). Over it, the game as cubes: as the work advances, cube after
 * cube (from the left) shrinks and moves into a packed group at the left, until all of them take about half the
 * room at 100 %; a thaw unpacks them again, from the right. The share and the size are written on the picture. The
 * bar's top and bottom lines run on to the right and fade; once the work ends, the result and an OK sit there. The
 * result confirms itself (`onConfirm`) on a click elsewhere or when the bar scrolls out of sight.
 */
export default function FreezeBar({ src, mode, percent, state, size, onConfirm }: { src: string; mode: FreezeMode; percent: number; state: State; size: string; onConfirm: () => void }) {
  const { t } = useI18n();
  const bar = useRef<HTMLDivElement>(null);
  const share = Math.max(0, Math.min(1, percent / 100));
  // How many cubes are packed now: freezing packs them from the first one, thawing unpacks them from the last.
  const packed = Math.round((mode === "thaw" ? 1 - share : share) * COUNT);
  const next = mode === "thaw" ? packed - 1 : packed;
  const ended = state !== "working";

  useEffect(() => {
    const element = bar.current;
    if (!ended || !element) return;
    const row = element.closest("tr") ?? element;
    const outside = (event: PointerEvent) => { if (!row.contains(event.target as Node)) onConfirm(); };
    const seen = new IntersectionObserver(entries => { if (entries.some(entry => !entry.isIntersecting)) onConfirm(); },
      { root: element.closest(".lm-grid-wrap"), threshold: 0 });
    // Armed a moment later: the click that ended nothing and the layout settling must not confirm it at once.
    const arm = window.setTimeout(() => { document.addEventListener("pointerdown", outside, true); seen.observe(element); }, 400);
    return () => { window.clearTimeout(arm); document.removeEventListener("pointerdown", outside, true); seen.disconnect(); };
  }, [ended, onConfirm]);

  const result = mode === "thaw" ? "lmThawComplete" : mode === "deep" ? "lmDeepFreezeComplete" : "lmFreezeComplete";
  return (
    <div ref={bar} className={`lm-fbar is-${state}`}>
      <img className="lm-fbar-picture" src={src} alt="" aria-hidden="true" />
      <div className="lm-fbar-cubes" aria-hidden="true">
        {Array.from({ length: COUNT }, (_, index) => {
          const place = index < packed ? small(index) : big(index);
          return <i key={index} className={`${index < packed ? "is-packed" : ""}${index === next && state === "working" ? " is-next" : ""}`}
            style={{ transform: `translate(${place.x}px, ${place.y}px) scale(${place.scale})`, transitionDelay: `${(index % BIG_ROWS) * 40}ms` }} />;
        })}
      </div>
      <div className="lm-fbar-readout" aria-hidden="true">
        <b>{Math.floor(percent)}<small>%</small></b>
        {size ? <span>{size}</span> : null}
      </div>
      {ended ? <div className="lm-fbar-result" role="status">
        <span>{t(state === "done" ? result : "lmFreezeIncomplete")}</span>
        <button type="button" onClick={onConfirm}>{t("lmFreezeOk")}</button>
      </div> : null}
    </div>
  );
}

/** The game's size for the readout: what has been gone through of the total while working, before and after once done. */
export function freezeSize(progress: { done_bytes: number; total_bytes: number; events: Array<{ kind: string; [value: string]: unknown }> } | undefined): string {
  if (!progress?.total_bytes) return "";
  const end = progress.events.find(event => event.kind === "done");
  if (end && end.original != null && end.stored != null) return `${formatBytes(Number(end.original))} → ${formatBytes(Number(end.stored))}`;
  return `${formatBytes(progress.done_bytes)} / ${formatBytes(progress.total_bytes)}`;
}
