import { createPortal } from "react-dom";
import { KeyRound, Lock } from "lucide-react";
import { useI18n } from "./i18n";
import { GaIconButton } from "./components/ga/Buttons";
import { requestAdmin, setAccessRole, useAccessRole, useAdminKey, usePlusLapsed } from "./accessRole";

/** Whether the frame shows only what a player may use (a parent's key is set and was not given): Seba, 2026-10-30. */
export function usePlayerFrame(): boolean {
  return useAccessRole() === "player";
}

/**
 * The frame's parent mode button (docs/GUI_DESIGN.md §0b). With a parent's key, Game Access opens as a player: the
 * frame hides settings, parental control and the account and plugin controls, and shows this button, which closes the
 * gate asking for the key. Once given, every button is back and this one returns to the player's frame at once.
 */
export default function ParentModeButton({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
  const { t } = useI18n();
  const role = useAccessRole();
  const key = useAdminKey();
  const lapsed = usePlusLapsed();
  if (!key.enabled || lapsed) return null;
  const button = role === "player"
    ? <GaIconButton className="ga-parent-mode" icon={<KeyRound size={20} aria-hidden="true" />} label={t("parentModeEnter")} onClick={() => void requestAdmin()} />
    : <GaIconButton className="ga-parent-mode" icon={<Lock size={20} aria-hidden="true" />} label={t("parentModeLeave")} pressed onClick={() => setAccessRole("player")} />;
  return dockTarget ? createPortal(button, dockTarget) : button;
}
