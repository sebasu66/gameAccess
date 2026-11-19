/**
 * A pad button (Seba, 2026-11-17; docs/GUI_DESIGN.md §4.42): a rounded key drawn in SVG, like the keys of a hardware
 * pad. Two looks: common (matte dark glass) and lit (`lit`: filled with its colour from below, with a glow); both
 * with a thin frame that catches light unevenly. Hovering brightens either one and tints the common frame.
 * `color` is any CSS colour or token (`var(--ga-orange)`); without it the flavor's pad colour is used.
 * Square with only an icon (`icon`), wider with a label (`children`): the SVG has no viewBox and its shapes are sized in
 * CSS, so the corners keep their radius at any width. `ink` says how the icon and label sit on the key: with a
 * shadow, engraved (a light edge under and a dark one over), printed (blended into the surface), printed and
 * engraved, debossed (sunk into the key: darker than its surface, lit from below) or outlined (a hairline of black); `halo` adds a soft blurred shadow behind them. Sizes in templates/base.css, the default colour and the glass in the flavor.
 */
import { forwardRef, useId, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import "./pad-button.css";

type Native = ButtonHTMLAttributes<HTMLButtonElement>;
export type PadInk = "shadow" | "engraved" | "printed" | "printed-engraved" | "debossed" | "outlined";

export interface GaPadButtonProps extends Native {
  /** Its name for screen readers and the tooltip (when it shows a label too, that label is read). */
  label: string;
  /** Lit (highlighted) instead of common. */
  lit?: boolean;
  /** The pad's colour: a CSS colour or a token. */
  color?: string;
  /** The pad works as an on/off key: `lit` is said as pressed. */
  toggle?: boolean;
  /** The icon on the key. */
  icon?: ReactNode;
  /** How icon and label sit on the key. */
  ink?: PadInk;
  /** A soft blurred shadow behind the icon and label (not around each letter). */
  halo?: boolean;
  /** A label beside the icon: the key grows wide. */
  children?: ReactNode;
}

export const GaPadButton = forwardRef<HTMLButtonElement, GaPadButtonProps>(function GaPadButton(
  { label, lit = false, color, toggle = false, icon, ink = "printed", halo = false, className, style, children, type = "button", ...rest }, ref,
) {
  const tint = color ? { ...style, "--ga-pad-color": color } as CSSProperties : style;
  const classes = ["ga-pad", lit && "is-lit", children ? "is-wide" : null, `ink-${ink}`, halo && "has-halo", className].filter(Boolean).join(" ");
  return (
    <button ref={ref} type={type} className={classes} style={tint}
      aria-label={children ? undefined : label} title={label} aria-pressed={toggle ? lit : undefined} {...rest}>
      <GaPadArt lit={lit} />
      {icon || children ? <span className="ga-pad-content">
        {icon ? <span className="ga-pad-icon" aria-hidden="true">{icon}</span> : null}
        {children ? <span className="ga-pad-label">{children}</span> : null}
      </span> : null}
    </button>
  );
});

/** The key itself (its SVG), for a button that keeps its own content: put it first inside a `ga-pad` button. */
export function GaPadArt({ lit = false }: { lit?: boolean }) {
  // Gradient ids must be unique on the page: one set per pad.
  const id = useId().replace(/:/g, "");
  return (
    <svg className="ga-pad-art" aria-hidden="true" focusable="false">
      <defs>
        {/* Lit: the colour rises from the bottom centre, darker towards the top corners. */}
        <radialGradient id={`${id}-lit`} cx="50%" cy="78%" r="78%">
          <stop offset="0%" className="ga-pad-lit-core" />
          <stop offset="55%" className="ga-pad-lit-mid" />
          <stop offset="100%" className="ga-pad-lit-rim" />
        </radialGradient>
        {/* Common: matte dark glass, almost flat. */}
        <linearGradient id={`${id}-off`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="ga-pad-off-top" />
          <stop offset="100%" className="ga-pad-off-bottom" />
        </linearGradient>
        {/* The frame of both: thin, catching light unevenly, more at the top and the bottom, slightly askew (the body
            itself is matte). Common in white, lit in its own colour. */}
        <linearGradient id={`${id}-edge`} x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0%" className="ga-pad-rim-light" />
          <stop offset="14%" className="ga-pad-rim-dim" />
          <stop offset="38%" className="ga-pad-rim-mid" />
          <stop offset="62%" className="ga-pad-rim-dim" />
          <stop offset="88%" className="ga-pad-rim-mid" />
          <stop offset="100%" className="ga-pad-rim-light" />
        </linearGradient>
        {/* Lit: a soft sheen over its top half. */}
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="ga-pad-sheen-top" />
          <stop offset="50%" className="ga-pad-sheen-bottom" />
        </linearGradient>
      </defs>
      <rect className="ga-pad-face" fill={`url(#${id}-${lit ? "lit" : "off"})`} />
      {lit ? <rect className="ga-pad-sheen" fill={`url(#${id}-sheen)`} /> : null}
      <rect className="ga-pad-edge" style={{ stroke: `url(#${id}-edge)` }} />
    </svg>
  );
}
