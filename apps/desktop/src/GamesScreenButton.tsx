import { createPortal } from "react-dom";
import { Gamepad2 } from "lucide-react";
import { useI18n } from "./i18n";
import { GaIconButton } from "./components/ga/Buttons";
import { setAppScreen, useAppScreen } from "./appScreen";

/** The frame's "Games" button (docs/GUI_DESIGN.md §0b): the catalog and the library, and the way back from any screen. */
export default function GamesScreenButton({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
  const { t } = useI18n();
  const screen = useAppScreen();
  const button = <GaIconButton className="ga-games-fab" icon={<Gamepad2 size={20} aria-hidden="true" />} label={t("screenGames")} pressed={screen === "games"} onClick={() => setAppScreen("games")} />;
  return dockTarget ? createPortal(button, dockTarget) : button;
}
