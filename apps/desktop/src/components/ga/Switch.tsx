/**
 * The on/off switch (Seba, 2026-11-17; docs/GUI_DESIGN.md §4.39): a track with a thumb that slides, orange when on,
 * with its name beside it. For a setting that takes effect at once (a disk used for games). A `role="switch"` button,
 * so Space and Enter flip it and screen readers say on or off. Sizes in templates/base.css, colours in the flavor.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./switch.css";

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "children">;

/** `locked`: shown but not changeable, still focusable and with its tooltip (aria-disabled), to say why. */
export function GaSwitch({ checked, onChange, label, busy, locked, className, type = "button", ...rest }: Native & {
  checked: boolean; onChange: (next: boolean) => void; label: ReactNode; busy?: boolean; locked?: boolean;
}) {
  return (
    <button type={type} role="switch" aria-checked={checked} aria-busy={busy || undefined} aria-disabled={locked || undefined}
      className={["ga-switch", busy && "is-busy", className].filter(Boolean).join(" ")} onClick={() => { if (!locked && !busy) onChange(!checked); }} {...rest}>
      <span className="ga-switch-track" aria-hidden="true"><span className="ga-switch-thumb" /></span>
      <span className="ga-switch-label">{label}</span>
    </button>
  );
}
