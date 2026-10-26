import type { CSSProperties } from "react";

type State = "working" | "done" | "failed";

/**
 * The game's own picture freezing, beside its log: a layer of ice (pale blue, see-through, blurring what is under it)
 * spreads over the picture with a soft edge while the picture is pressed down to half its size; a thaw runs the other
 * way (the ice withdraws and the picture grows back). Plain elements and CSS (one blurred layer, transitions on one
 * number), nothing drawn frame by frame.
 */
export default function FrostImage({ src, thaw, percent, state }: { src: string; thaw: boolean; percent: number; state: State }) {
  // How much of the picture is ice, 0..1: freezing fills it, thawing empties it.
  const ice = Math.max(0, Math.min(1, thaw ? 1 - percent / 100 : percent / 100));
  return (
    <div className={`lm-frost is-${state}`} style={{ "--ice": ice } as CSSProperties} aria-hidden="true">
      <div className="lm-frost-picture">
        <img src={src} alt="" />
        <i className="lm-frost-ice" />
      </div>
    </div>
  );
}
