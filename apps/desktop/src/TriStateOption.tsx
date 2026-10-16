import { CircleMinus, CirclePlus } from "lucide-react";
import { useI18n } from "./i18n";

export type TriState = "off" | "include" | "exclude";

/**
 * One criterion with both directions.
 *
 * A single checkbox cannot express "adventure but not role-playing", so each
 * option carries an include and an exclude button instead. Both are explicit
 * rather than a cycling control: cycling hides which state you are in, and these
 * choices are the point of the panel.
 */
export default function TriStateOption({ label, hint, state, locked, lockedTitle, disabled, disabledTitle, onSet }: {
  label: string;
  /** Extra text after the label, e.g. a count. */
  hint?: string;
  state: TriState;
  /** A parental criterion: negative only, and not changeable here. */
  locked?: boolean;
  lockedTitle?: string;
  /** Unavailable because a contradicting choice is active, or its branch does not apply. */
  disabled?: boolean;
  disabledTitle?: string;
  onSet: (state: TriState) => void;
}) {
  const { t } = useI18n();
  const next = (value: TriState) => onSet(state === value ? "off" : value);
  if (locked) {
    return (
      <span className="ga-tristate is-locked" data-state="exclude">
        <span className="ga-tristate-label">{label}{hint ? <small>{hint}</small> : null}</span>
        <span className="ga-tristate-fixed" title={lockedTitle} aria-label={lockedTitle}>{t("uiSoloExcluir")}</span>
      </span>
    );
  }
  return (
    <span className={"ga-tristate" + (disabled ? " is-unavailable" : "")} data-state={state} title={disabled ? disabledTitle : undefined}>
      <span className="ga-tristate-label">{label}{hint ? <small>{hint}</small> : null}</span>
      <button
        type="button"
        className={"ga-tristate-button is-include" + (state === "include" ? " is-active" : "")}
        aria-pressed={state === "include"}
        disabled={disabled}
        title={disabled ? disabledTitle : state === "include" ? t("triStopRequiring", { name: label }) : t("triOnlyGamesWith", { name: label })}
        onClick={() => next("include")}
      ><CirclePlus size={13} aria-hidden="true" /><span className="ga-visually-hidden">{t("triRequire", { name: label })}</span></button>
      <button
        type="button"
        className={"ga-tristate-button is-exclude" + (state === "exclude" ? " is-active" : "")}
        aria-pressed={state === "exclude"}
        disabled={disabled}
        title={disabled ? disabledTitle : state === "exclude" ? t("triStopExcluding", { name: label }) : t("triExcludeGamesWith", { name: label })}
        onClick={() => next("exclude")}
      ><CircleMinus size={13} aria-hidden="true" /><span className="ga-visually-hidden">{t("excludeNamed", { name: label })}</span></button>
    </span>
  );
}
