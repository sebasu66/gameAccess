import type { CSSProperties } from "react";
import { formatBytes } from "../GenericDownloadProgress";

type State = "working" | "done" | "failed";

/**
 * The game's own picture freezing, beside its log: a layer of ice (pale blue, see-through, blurring what is under it)
 * spreads over the picture with a soft edge while the picture is pressed down to half its size, towards the centre
 * of its place; a thaw runs the other way (the ice withdraws and the picture grows back). Where the full picture
 * sits, fine lines fading at their ends keep the frame, with the share at one corner and the game's size at the
 * other (its size before and after, once done). Plain elements and CSS, nothing drawn frame by frame.
 */
export default function FrostImage({ src, thaw, percent, state, size }: { src: string; thaw: boolean; percent: number; state: State; size: string }) {
  // How much of the picture is ice, 0..1: freezing fills it, thawing empties it.
  const ice = Math.max(0, Math.min(1, thaw ? 1 - percent / 100 : percent / 100));
  return (
    <div className={`lm-frost is-${state}`} style={{ "--ice": ice } as CSSProperties} aria-hidden="true">
      <i className="lm-frost-lines" />
      <div className="lm-frost-picture">
        <img src={src} alt="" />
        <i className="lm-frost-ice" />
      </div>
      <b className="lm-frost-share">{Math.floor(percent)}<small>%</small></b>
      {size ? <span className="lm-frost-size">{size}</span> : null}
    </div>
  );
}

/** The game's size for the frame: what has been gone through of the total while working, before and after once done. */
export function frostSize(progress: { done_bytes: number; total_bytes: number; events: Array<{ kind: string; [value: string]: unknown }> } | undefined): string {
  if (!progress?.total_bytes) return "";
  const end = progress.events.find(event => event.kind === "done");
  if (end && end.original != null && end.stored != null) return `${formatBytes(Number(end.original))} → ${formatBytes(Number(end.stored))}`;
  return `${formatBytes(progress.done_bytes)} / ${formatBytes(progress.total_bytes)}`;
}
