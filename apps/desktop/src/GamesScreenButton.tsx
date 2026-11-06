import { createPortal } from "react-dom";
import { Gamepad2, HardDrive } from "lucide-react";
import { useI18n } from "./i18n";
import { GaIconButton } from "./components/ga/Buttons";
import { setAppScreen, useAppScreen } from "./appScreen";
import { closeLibraryManager, openLibraryManager, useLibraryManagerShown } from "./libraryManagerNav";

/** The frame's "Games" button (docs/GUI_DESIGN.md §0b): the catalog and the library, and the way back from any screen. */
export default function GamesScreenButton({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
  const { t } = useI18n();
  const screen = useAppScreen();
  const manager = useLibraryManagerShown();
  const button = <GaIconButton className="ga-games-fab" icon={<Gamepad2 size={20} aria-hidden="true" />} label={t("screenGames")} pressed={screen === "games" && !manager}
    onClick={() => { setAppScreen("games"); if (manager) closeLibraryManager(); }} />;
  return dockTarget ? createPortal(button, dockTarget) : button;
}

/**
 * The frame's "Library Manager" button (Seba, 2026-11-02): the manager is a mode like Games, Home or Settings, always
 * at hand from the frame, without going through the library first.
 */
export function LibraryManagerButton({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
  const { t } = useI18n();
  const screen = useAppScreen();
  const manager = useLibraryManagerShown();
  const button = <GaIconButton className="ga-manager-fab" icon={<HardDrive size={20} aria-hidden="true" />} label={t("libraryManagerButton")} pressed={screen === "games" && manager}
    onClick={() => openLibraryManager()} />;
  return dockTarget ? createPortal(button, dockTarget) : button;
}
