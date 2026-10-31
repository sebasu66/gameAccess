import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Baby, Sparkles } from "lucide-react";
import { useI18n } from "./i18n";
import { GaButton, GaIconButton } from "./components/ga/Buttons";
import GaScreen from "./components/ga/Screen";
import { setAppScreen, useAppScreen } from "./appScreen";
import { OPEN_PREMIUM_EVENT } from "./PremiumEntry";
import { loadAdminKey, requestParentKey, useAdminKey, usePlusGraceDays, usePlusLapsed } from "./accessRole";
import { loadKidFamily, useKidState } from "./kidMode";
import KidWizard, { type KidReady } from "./KidWizard";
import KidReadyDialog from "./KidReadyDialog";
import KidControlPanel from "./KidControlPanel";
import "./kid-mode.css";

/**
 * The kids screen (vault/Modo niño.md). While kid mode is off it is the page that explains the features and, with
 * PLUS, the wizard below it (KidWizard.tsx). Once the child's account exists it is the control panel (KidControlPanel.tsx).
 * Once kid mode is set up, opening it asks for the parent's key (ParentKeyDialog.tsx). It is a screen chosen from the frame
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
  // The wizard's last word, a large dialog (MN.27): kept here because the wizard gives way to the panel when it ends.
  const [ready, setReady] = useState<KidReady | null>(null);
  return <GaScreen id="ga-kid" title={t("familyTitle")} subtitle={t("familySubtitle")} className="ga-kid-panel">
    <div className="ga-kid-content ga-stack ga-stack-lg">
      <PlusLapsedNote />
      {applied ? <KidControlPanel /> : <KidWizard onPlus={knowPlus} onReady={setReady} />}
    </div>
    {ready ? <KidReadyDialog {...ready} onClose={() => setReady(null)} /> : null}
  </GaScreen>;
}

export default function KidModePanel({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
  const { t } = useI18n();
  const screen = useAppScreen();
  useEffect(() => { void loadKidFamily(); void loadAdminKey().catch(() => undefined); }, []);
  const open = () => { if (screen !== "kids") void requestParentKey().then(ok => { if (ok) setAppScreen("kids"); }); };
  const button = <GaIconButton className="ga-kid-fab" icon={<Baby size={20} aria-hidden="true" />} label={t("familyTitle")} pressed={screen === "kids"} onClick={open} />;
  return <>
    {dockTarget ? createPortal(button, dockTarget) : button}
    {screen === "kids" ? <KidScreen /> : null}
  </>;
}
