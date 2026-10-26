import { FreezeArt } from "../FreezeConsole";
import type { FreezeMode } from "../FreezeDialog";
import { formatBytes } from "../GenericDownloadProgress";

type State = "working" | "done" | "failed";

/**
 * The freeze shown beside the game's log: the same picture as the freeze console (files go into a press and come out
 * as a block of ice that fills with the share; a strapped crate for the deep freeze; the other way for a thaw), drawn
 * straight on the background, faint, in a place of constant size that keeps the log's top line and height. The share
 * sits at one corner and the game's size at the other.
 */
export default function FrostImage({ mode, percent, state, size }: { mode: FreezeMode; percent: number; state: State; size: string }) {
  return (
    <div className={`lm-frost is-${state}`} aria-hidden="true">
      <FreezeArt mode={mode} percent={percent} state={state} />
      <b className="lm-frost-share">{Math.floor(percent)}<small>%</small></b>
      {size ? <span className="lm-frost-size">{size}</span> : null}
    </div>
  );
}

/** The game's size for the corner: what has been gone through of the total while working, before and after once done. */
export function frostSize(progress: { done_bytes: number; total_bytes: number; events: Array<{ kind: string; [value: string]: unknown }> } | undefined): string {
  if (!progress?.total_bytes) return "";
  const end = progress.events.find(event => event.kind === "done");
  if (end && end.original != null && end.stored != null) return `${formatBytes(Number(end.original))} → ${formatBytes(Number(end.stored))}`;
  return `${formatBytes(progress.done_bytes)} / ${formatBytes(progress.total_bytes)}`;
}
