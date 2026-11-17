/**
 * The interface's buttons, one definition each (docs/GUI_DESIGN.md §4): the primary/secondary/danger/frost
 * action, the glass cube used for commands on the main screen, the red close circle and the full-screen back
 * button. Every label comes translated from the caller.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";

type Native = ButtonHTMLAttributes<HTMLButtonElement>;
const join = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(" ");

export type GaButtonVariant = "primary" | "secondary" | "danger" | "frost";

/** Action button: 44 px high (54 px with `size="tall"`, only in the game detail row). */
export const GaButton = forwardRef<HTMLButtonElement, Native & { variant?: GaButtonVariant; size?: "regular" | "tall"; icon?: ReactNode }>(
  function GaButton({ variant = "secondary", size = "regular", icon, className, children, type = "button", ...rest }, ref) {
    return <button ref={ref} type={type} className={join(`ga-btn-${variant}`, size === "tall" && "ga-btn-tall", className)} {...rest}>{icon}{children}</button>;
  },
);

/**
 * Glass cube for commands on the main screen: icon only; its name unfolds next to the icon on hover or focus.
 * `pressed` makes it a toggle (orange tint and a lit line below); `badge` shows a small count (hidden at 0).
 */
export const GaIconButton = forwardRef<HTMLButtonElement, Native & { icon: ReactNode; label: string; pressed?: boolean; badge?: number }>(
  function GaIconButton({ icon, label, pressed, badge, className, type = "button", ...rest }, ref) {
    return (
      <button ref={ref} type={type} className={join("ga-cube", className)} aria-label={label} aria-pressed={pressed} {...rest}>
        {icon}
        <span className="ga-cube-label">{label}</span>
        {badge ? <span className="ga-cube-badge" aria-hidden="true">{badge > 99 ? "99+" : badge}</span> : null}
      </button>
    );
  },
);

/** The one close control: red circle, 38 px, top right of every overlay. */
export function GaClose({ label, className, size = 20, ...rest }: Native & { label: string; size?: number }) {
  return <button type="button" className={join("ga-close", className)} aria-label={label} title={label} {...rest}><X size={size} aria-hidden="true" /></button>;
}

/** Back button of full-screen surfaces: same red as the close control, arrow and text, 54 px high. */
export function GaBack({ label, className, ...rest }: Native & { label: string }) {
  return <button type="button" className={join("ga-back", className)} {...rest}><ArrowLeft size={18} aria-hidden="true" />{label}</button>;
}
