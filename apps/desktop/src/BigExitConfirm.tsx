/**
 * Big picture mode asks before leaving (Seba, 2026-11-10): the Menu button, Esc, F11, the footer button and the side
 * rail's Leave all land here. On the smoke layer, as the question before playing (BigPlayConfirm). The first moments
 * do not count, so the same press that opened it does not leave too.
 */
import { useRef } from "react";
import { LogOut } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { GaSmoke } from "./components/ga/GaSmoke";
import { useI18n } from "./i18n";
import { useBigPictureView } from "./bigPicture";
import "./big-picture-browse.css";

const ARMED_AFTER_MS = 350;

export default function BigExitConfirm({ onLeave, onStay }: { onLeave: () => void; onStay: () => void }) {
  const { t } = useI18n();
  const { input } = useBigPictureView();
  const opened = useRef(performance.now());
  const leave = () => { if (performance.now() - opened.current >= ARMED_AFTER_MS) onLeave(); };
  return <GaSmoke className="ga-big-exit" label={t("bigExitTitle")} onClose={onStay}>
    <LogOut className="ga-big-exit-icon" size={56} strokeWidth={1.6} aria-hidden="true" />
    <h2 className="ga-big-exit-title">{t("bigExitTitle")}</h2>
    <p className="ga-big-exit-text">{t("bigExitText")}</p>
    <div className="ga-actions">
      <GaButton data-autofocus variant="primary" size="tall" icon={<LogOut size={18} aria-hidden="true" />} onClick={leave}>{t("bigExitLeave")}</GaButton>
      <GaButton size="tall" onClick={onStay}>{t("bigExitStay")}</GaButton>
    </div>
    <p className="ga-hint ga-big-keys">{input === "pad"
      ? <><span className="ga-pad-key is-a">A</span> {t("bigExitLeave")} <span className="ga-pad-key">B</span> {t("bigExitStay")}</>
      : <><kbd className="ga-pad-key">{t("bigKeyEnter")}</kbd> {t("bigExitLeave")} <kbd className="ga-pad-key">{t("bigKeyEsc")}</kbd> {t("bigExitStay")}</>}</p>
  </GaSmoke>;
}
