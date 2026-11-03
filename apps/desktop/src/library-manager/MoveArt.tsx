import { formatBytes } from "../GenericDownloadProgress";
import { GameWideArt } from "../GameArt";
import SteamCover from "../SteamCover";
import type { CatalogGame } from "../types";

type State = "working" | "done" | "failed";

/** The one size the picture shows: what is still left to copy (nothing once it ended). */
export function moveLeft(progress: { done_bytes: number; total_bytes: number; finished?: boolean } | undefined, state: State): string {
  if (!progress?.total_bytes || state !== "working") return "";
  return formatBytes(Math.max(0, progress.total_bytes - progress.done_bytes));
}

/**
 * A linked game moving into the library, beside the game's log (in the place of the freeze bar): the game's portrait
 * cover on the left, in its frame, and a folder drawn as a plain outline on the right, about as high, with a short
 * gap between them where files keep flowing from the cover into the folder. As the bytes are copied the cover empties
 * from the top down (the frame stays) and the game's wide picture, centred in the folder (filled faintly behind it so
 * it reads as a folder), fills from the bottom up:
 * at 100 % the frame on the left is empty and the folder full. Cancelled, the caller passes 0 % (the game is back where
 * it was); a failure stands still with a red frame. The share and what is left to copy are written under the flowing files.
 * Both pictures repair themselves (SteamCover, GameWideArt): a recent game has no unhashed Steam art.
 */
export default function MoveArt({ game, percent, state, size }: { game: Pick<CatalogGame, "app_id" | "name">; percent: number; state: State; size: string }) {
  const share = Math.max(0, Math.min(100, percent));
  return (
    <div className={`lm-move is-${state}`} aria-hidden="true">
      <div className="lm-move-cover">
        <div className="lm-move-clip" style={{ clipPath: `inset(${share}% 0 0 0)` }}><SteamCover game={{ id: game.app_id ?? 0, ...game } as CatalogGame} /></div>
      </div>
      <div className="lm-move-middle">
        <div className="lm-move-flow">
          {state === "working" ? [0, 1, 2, 3].map(index => (
            <svg key={index} className="lm-move-file" viewBox="0 0 16 20" style={{ animationDelay: `${index * -0.45}s` }}>
              <path d="M1 1 H10 L15 6 V19 H1 Z M10 1 V6 H15" />
            </svg>
          )) : null}
        </div>
        <div className="lm-move-readout">
          <b>{Math.floor(share)}<small>%</small></b>
          {size ? <span>{size}</span> : null}
        </div>
      </div>
      <div className="lm-move-folder">
        <svg className="lm-move-outline" viewBox="0 0 120 100" preserveAspectRatio="none">
          <path d="M3 14 V94 a3 3 0 0 0 3 3 H114 a3 3 0 0 0 3 -3 V24 a3 3 0 0 0 -3 -3 H54 L45 9 H6 a3 3 0 0 0 -3 3 Z" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="lm-move-inner">
          <div className="lm-move-clip" style={{ clipPath: `inset(${100 - share}% 0 0 0)` }}><GameWideArt game={game} lazy={false} /></div>
        </div>
      </div>
    </div>
  );
}
