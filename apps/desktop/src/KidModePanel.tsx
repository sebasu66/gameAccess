import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Baby, Sparkles } from "lucide-react";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import { GaButton, GaClose, GaIconButton } from "./components/ga/Buttons";
import { OPEN_PREMIUM_EVENT } from "./PremiumEntry";
import { loadAdminKey, useAdminKey, usePlusGraceDays, usePlusLapsed } from "./accessRole";
import { loadKidFamily, useKidState } from "./kidMode";
import KidWizard from "./KidWizard";
import KidControlPanel from "./KidControlPanel";
import "./kid-mode.css";

/**
 * The kids screen (vault/Modo niño.md). While kid mode is off it is the page that explains the features and, with
 * PLUS, the wizard below it (KidWizard.tsx). Once the child's account exists it is the control panel (KidControlPanel.tsx).
 * Anyone may open it; changes need the administrator (the parent's key).
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
function FamilyDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const panel = useDialogFocus(onClose);
  const { applied } = useKidState();
  return <div className="ga-settings-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="ga-settings-panel ga-kid-panel" role="dialog" aria-modal="true" aria-labelledby="ga-kid-title">
      <header><div><span className="eyebrow">GAME ACCESS</span><h2 id="ga-kid-title">{t("familyTitle")}</h2><p>{t("familySubtitle")}</p></div><GaClose label={t("close")} onClick={onClose} data-dialog-initial /></header>
      <div className="ga-settings-content ga-kid-content ga-stack ga-stack-lg">
        <PlusLapsedNote />
        {applied ? <KidControlPanel /> : <KidWizard onPlus={knowPlus} />}
      </div>
    </section>
  </div>;
}

export default function KidModePanel({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { void loadKidFamily(); void loadAdminKey().catch(() => undefined); }, []);
  const close = useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }, []);
  const button = <GaIconButton ref={trigger} className="ga-kid-fab" icon={<Baby size={20} aria-hidden="true" />} label={t("familyTitle")} onClick={() => setOpen(true)} />;
  return <>
    {dockTarget ? createPortal(button, dockTarget) : button}
    {open ? <FamilyDialog onClose={close} /> : null}
  </>;
}
