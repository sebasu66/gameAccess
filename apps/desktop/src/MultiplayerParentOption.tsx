import { Infinity as InfinityIcon } from "lucide-react";
import { useI18n } from "./i18n";

/**
 * The parent of the multiplayer tree.
 *
 * Selecting it turns the tree on; its children are requirements inside it. Kept
 * apart from the child rows because it is not one of them: it is the switch that
 * gives them meaning.
 */
export default function MultiplayerParentOption({ selected, disabled, onToggle }: {
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <label className={"ga-tree-parent" + (selected ? " is-selected" : "") + (disabled ? " is-branch-disabled" : "")}
      title={disabled ? t("multiplayerNotWithSolo") : t("multiplayerGames")}>
      <input type="checkbox" tabIndex={-1} checked={selected} disabled={disabled} onChange={onToggle} />
      <strong>{t("uiAdmiteMultijugador")}</strong>
      <small>{t("uiTodoLoDeAbajo")}</small>
    </label>
  );
}

/** Marker used by the sliders when a bound is disabled. */
export const NO_BOUND_ICON = InfinityIcon;
