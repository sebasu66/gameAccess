import { Gamepad2, Menu } from "lucide-react";
import { useI18n } from "./i18n";
import { Leaf } from "./SplashScreen";

/** The controller's Menu button (☰), drawn as a small key with its name, as the legend and the intro show it. */
export function MenuKey() {
  const { t } = useI18n();
  return <span className="ga-pad-key is-menu"><Menu size={15} strokeWidth={2.6} aria-hidden="true" /><span>{t("bigPictureMenuButton")}</span></span>;
}

/**
 * Big picture mode's change (motion/bigPictureMotion.ts) uses the opening's gate the other way round: the two leaves
 * close over the screen while the window goes fullscreen and the grid changes behind them, then open again. Entering,
 * behind the gate waits a card with the mode's name, what it is for and how to leave it with the controller. The lock
 * is shown already unlocked (`is-still`: no drawing, no turning; GSAP moves the leaves). Always in the page, hidden.
 */
export default function BigPictureIntro() {
  const { t } = useI18n();
  return (<>
    <div className="gameaccess-splash gs-gate is-still ga-big-gate" aria-hidden="true">
      <Leaf side="left" />
      <Leaf side="right" />
    </div>
    <div className="ga-big-intro" role="status" aria-live="polite">
      <div className="ga-big-intro-card">
        <Gamepad2 className="ga-big-intro-icon" size={64} strokeWidth={1.6} aria-hidden="true" />
        <p className="ga-big-intro-eyebrow ga-big-intro-line">{t("bigPictureIntroEyebrow")}</p>
        <h2 className="ga-big-intro-title">{t("bigPictureTitle")}</h2>
        <p className="ga-big-intro-text ga-big-intro-line">{t("bigPictureHint")}</p>
        <p className="ga-big-intro-exit ga-big-intro-line">{t("bigPictureExitBefore")} <MenuKey /> {t("bigPictureExitAfter")}</p>
      </div>
    </div>
  </>);
}
