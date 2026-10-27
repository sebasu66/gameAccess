import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Snowflake, Trash2, X } from "lucide-react";
import { gsap, motionOk, useGSAP } from "../motion/gsap";
import { useI18n } from "../i18n";
import { GaButton } from "../components/ga/Buttons";
import { hideNotice, useNotice, type Notice, type NoticeTone } from "./notice";
import { useOpeningSettled } from "../centralDialog/openingSettled";
import "./notice.css";

const TONE_ICON: Record<NoticeTone, typeof Check> = { ok: Check, info: Download, frost: Snowflake, danger: Trash2, error: AlertTriangle };

/** The single notice, mounted once at the app root (docs/GUI_DESIGN.md §4.9). */
export default function GaNotice() {
  const { t } = useI18n();
  const notice = useNotice();
  // The opening (the cover with its doors) protects the device: nothing shows over it; the notice waits until it opened.
  const opened = useOpeningSettled();
  const [shown, setShown] = useState<Notice | null>(notice);
  const root = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);

  // A new notice shows at once; when the store empties, the visible one animates out first.
  useEffect(() => {
    if (notice) { leaving.current = false; setShown(notice); return; }
    if (!shown || !root.current || !motionOk()) { setShown(null); return; }
    leaving.current = true;
    const tween = gsap.to(root.current, { y: -24, opacity: 0, duration: .4, ease: "power2.in", onComplete: () => { if (leaving.current) setShown(null); } });
    return () => { tween.kill(); };
  }, [notice]); // eslint-disable-line react-hooks/exhaustive-deps

  useGSAP(() => {
    if (!shown || !root.current || !motionOk()) return;
    gsap.fromTo(root.current, { x: 40, y: 0, opacity: 0 }, { x: 0, opacity: 1, duration: .55, ease: "expo.out", overwrite: true });
  }, { dependencies: [Boolean(shown) && opened], scope: root });

  useGSAP(() => {
    if (!shown || !root.current || !motionOk()) return;
    gsap.fromTo(root.current.querySelectorAll(".ga-notice-head, .ga-notice-steps, .ga-notice-actions"), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .3, stagger: .04, ease: "power3.out" });
  }, { dependencies: [shown?.id, opened], scope: root });

  // Error and confirmation notices take the keyboard focus on their first button; Esc presses the first (Cancel/Close).
  useEffect(() => {
    if (!shown || !opened || shown.timer || !shown.actions.length) return;
    const first = root.current?.querySelector<HTMLButtonElement>(".ga-notice-actions button");
    first?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); shown.actions[0].run(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [shown?.id, opened]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown || !opened) return null;
  const Icon = TONE_ICON[shown.tone];
  return (
    <div ref={root} className="ga-notice" data-tone={shown.tone} data-timer={shown.timer || undefined} role={shown.tone === "error" ? "alert" : "status"} aria-live="polite" aria-label={t("toastRegion")}>
      <div className="ga-notice-head">
        {shown.game?.image ? <img className="ga-notice-art" src={shown.game.image} alt="" /> : <span className="ga-notice-icon"><Icon size={18} aria-hidden="true" /></span>}
        <div className="ga-notice-text"><strong>{shown.title}</strong>{shown.text ? <span>{shown.text}</span> : null}</div>
      </div>
      {shown.timer ? (
        <button type="button" key={shown.id} className="ga-notice-timer" title={t("toastDismiss")} aria-label={t("toastDismiss")} onClick={() => hideNotice(shown.id)}>
          <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" className="track" /><circle cx="18" cy="18" r="15" className="run" pathLength={100} onAnimationEnd={() => hideNotice(shown.id)} /></svg>
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
      {shown.steps?.length ? (
        <ol className="ga-notice-steps">{shown.steps.map((step, index) => <li key={index} data-state={step.state}><i aria-hidden="true" />{step.label}</li>)}</ol>
      ) : null}
      {shown.actions.length ? (
        <div className="ga-notice-actions">{shown.actions.map(action => <GaButton key={action.label} variant={action.kind ?? "secondary"} onClick={action.run}>{action.label}</GaButton>)}</div>
      ) : null}
      {shown.progress !== undefined ? <i className="ga-notice-progress" data-indeterminate={shown.progress === null || undefined}><b style={shown.progress === null ? undefined : { transform: `scaleX(${shown.progress})` }} /></i> : null}
    </div>
  );
}
