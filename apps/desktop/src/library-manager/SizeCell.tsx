import { Snowflake } from "lucide-react";
import type { LibraryGame } from "../catalog/DigitalProcessManager";
import type { LibraryCopy } from "./copy";
import { formatBytes } from "./format";

/** Size of a row: what the game takes and a thin grey bar. A frozen game shows its size on disk in frost blue and,
 *  next to it, its size unfrozen in half-transparent orange (no strike-through, no "saves X"). */
export function SizeCell({ game, largest, c }: { game: LibraryGame; largest: number; c: LibraryCopy }) {
  const value = game.partial ? game.transfer_bytes ?? 0 : game.size_bytes ?? 0;
  const original = game.original_bytes ?? game.size_bytes ?? 0, stored = game.frozen_bytes ?? null;
  const frozen = Boolean(game.frozen && stored != null && original);
  const shown = frozen ? stored ?? 0 : value;
  return (
    <div className="lm-size" data-frozen={frozen ? game.frozen : undefined}>
      <span className="lm-size-figures">
        {frozen ? <>
          <span className="lm-frozen-size" title={c.frozenSize}><Snowflake aria-hidden="true" />{formatBytes(stored)}</span>
          <span className="lm-unfrozen-size" title={c.unfrozenSize}>{formatBytes(original)}</span>
        </> : <span>{value ? formatBytes(value) : "—"}</span>}
      </span>
      <span className="lm-sbar"><i className={frozen ? "frozen" : game.partial ? "partial" : undefined} style={{ width: `${Math.min(100, (shown / Math.max(1, largest, game.transfer_bytes ?? 0)) * 100)}%` }} /></span>
    </div>
  );
}
