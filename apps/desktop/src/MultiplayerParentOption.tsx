import { Infinity as InfinityIcon } from "lucide-react";

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
  return (
    <label className={"ga-tree-parent" + (selected ? " is-selected" : "") + (disabled ? " is-branch-disabled" : "")}
      title={disabled ? "No aplica a \"Solo un jugador\"" : "Juegos que admiten multijugador"}>
      <input type="checkbox" checked={selected} disabled={disabled} onChange={onToggle} />
      <strong>Admite multijugador</strong>
      <small>Todo lo de abajo es un requisito dentro de este grupo</small>
    </label>
  );
}

/** Marker used by the sliders when a bound is disabled. */
export const NO_BOUND_ICON = InfinityIcon;
