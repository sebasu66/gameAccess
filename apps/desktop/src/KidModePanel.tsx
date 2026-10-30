import { useEffect } from "react";
import { usePlayerFrame } from "./ParentModeButton";
import { createPortal } from "react-dom";
import { Baby, Sparkles } from "lucide-react";
import { useI18n } from "./i18n";
import { GaButton, GaIconButton } from "./components/ga/Buttons";
import GaScreen from "./components/ga/Screen";
import { setAppScreen, useAppScreen } from "./appScreen";
import { OPEN_PREMIUM_EVENT } from "./PremiumEntry";
import { loadAdminKey, useAdminKey, usePlusGraceDays, usePlusLapsed } from "./accessRole";
import { loadKidFamily, useKidState } from "./kidMode";
import KidWizard from "./KidWizard";
import KidControlPanel from "./KidControlPanel";
import "./kid-mode.css";

/**
 * The kids screen (vault/Modo niño.md). While kid mode is off it is the page that explains the features and, with
 * PLUS, the wizard below it (KidWizard.tsx). Once the child's account exists it is the control panel (KidControlPanel.tsx).
 * Anyone may open it; changes need the administrator (the parent's key). It is a screen chosen from the frame
 * (docs/GUI_DESIGN.md §0b), not a dialog: no close button, one leaves it by choosing another mode.
 */
const knowPlus = () => window.dispatchEvent(new Event(OPEN_PREMIUM_EVENT));

/** PLUS was on and is not any more: what happens to what was set up (kid mode paused, the key asleep), and the way back. */
function PlusLapsedNote() {
  const { t } = useI18n();
  const lapsed = usePlusLapsed();
  const grace = usePlusGraceDays();
  const { applied } = useKidState();
  const key = useAdminKey();
  if (!(applied || key.enabled)) return null;
  // No connection to check PLUS: everything keeps working for a few days, and the notice says how many.
  if (!lapsed && grace !== null) return <div className="ga-kid-plus ga-kid-lapsed ga-status" role="status"><Sparkles size={18} aria-hidden="true" />
    <div><strong>{t("plusGraceTitle")}</strong><p>{t("plusGraceText", { days: String(grace) })}</p></div></div>;
  if (!lapsed) return null;
  return <div className="ga-kid-plus ga-kid-lapsed ga-status" role="alert">
    <Sparkles size={18} aria-hidden="true" />
    <div><strong>{t("plusLapsedTitle")}</strong><p>{t("plusLapsedText")}</p></div>
    <GaButton variant="primary" onClick={knowPlus}>{t("kidIntroKnowPlus")}</GaButton>
  </div>;
}

/** The one place for everything about the children: kid mode, the adult content filter and the parent's key. */
function KidScreen() {
  const { t } = useI18n();
  const { applied } = useKidState();
  return <GaScreen id="ga-kid" title={t("familyTitle")} subtitle={t("familySubtitle")} className="ga-kid-panel">
    <div className="ga-kid-content ga-stack ga-stack-lg">
      <PlusLapsedNote />
      {applied ? <KidControlPanel /> : <KidWizard onPlus={knowPlus} />}
    </div>
  </GaScreen>;
}

export default function KidModePanel({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
  const { t } = useI18n();
  const screen = useAppScreen();
  useEffect(() => { void loadKidFamily(); void loadAdminKey().catch(() => undefined); }, []);
  // A player's frame has no parental control (ParentModeButton.tsx).
  const player = usePlayerFrame();
  useEffect(() => { if (player && screen === "kids") setAppScreen("games"); }, [player, screen]);
  // Hidden, not removed: a dock button keeps its place when it comes back.
  const button = <GaIconButton className="ga-kid-fab" icon={<Baby size={20} aria-hidden="true" />} label={t("familyTitle")} hidden={player} pressed={screen === "kids"} onClick={() => setAppScreen("kids")} />;
  return <>
    {dockTarget ? createPortal(button, dockTarget) : button}
    {screen === "kids" && !player ? <KidScreen /> : null}
  </>;
}
