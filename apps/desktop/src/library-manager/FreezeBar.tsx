import type { FreezeMode } from "../FreezeDialog";
import { formatBytes } from "../GenericDownloadProgress";

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
 * room at 100 %; a thaw unpacks them again, from the right. The share and the size are written on the picture. Behind
 * the picture a faint grid of lines completes the bar's shape and runs on to the right, fading out. The result of the
 * work is told in the app's notice (freezeJobs), not here. (A move into the library has its own picture: MoveArt.)
 */
export default function FreezeBar({ src, mode, percent, state, size }: { src: string; mode: FreezeMode; percent: number; state: State; size: string }) {
  const share = Math.max(0, Math.min(1, percent / 100));
  // How many cubes are packed now: freezing packs them from the first one, thawing unpacks them from the last.
  const packed = Math.round((mode === "thaw" ? 1 - share : share) * COUNT);
  const next = mode === "thaw" ? packed - 1 : packed;
  return (
    <div className={`lm-fbar is-${state}`}>
      <i className="lm-fbar-grid" aria-hidden="true" />
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
    </div>
  );
}

/** The game's size for the readout: what has been gone through of the total while working, before and after once done. */
export function freezeSize(progress: { done_bytes: number; total_bytes: number; events: Array<{ kind: string; [value: string]: unknown }> } | undefined): string {
  if (!progress?.total_bytes) return "";
  const end = progress.events.find(event => event.kind === "done");
  if (end && end.moved != null) return formatBytes(Number(end.moved));
  if (end && end.original != null && end.stored != null) return `${formatBytes(Number(end.original))} → ${formatBytes(Number(end.stored))}`;
  return `${formatBytes(progress.done_bytes)} / ${formatBytes(progress.total_bytes)}`;
}
