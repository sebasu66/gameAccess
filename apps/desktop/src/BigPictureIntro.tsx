import { useRef, useState, useEffect } from "react";
import { Gamepad2, Menu } from "lucide-react";
import { useI18n } from "./i18n";
import { gsap, motionOk, useGSAP } from "./motion/gsap";

/** How long the card stays, not counting its way in and out. */
const HOLD = 1.9;

/** The controller's Menu button (☰), drawn as a small key with its name, as the legend and the intro show it. */
export function MenuKey() {
  const { t } = useI18n();
  return <span className="ga-pad-key is-menu"><Menu size={15} strokeWidth={2.6} aria-hidden="true" /><span>{t("bigPictureMenuButton")}</span></span>;
}

/**
 * Entering big picture mode says so clearly, as consoles do: a card in the middle of the screen with the mode's name,
 * what it is for and how to leave it with the controller, which then gives way to the library. It does not block
 * anything: the controller already works under it.
 */
export default function BigPictureIntro({ active }: { active: boolean }) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => { if (active) setShown(true); else setShown(false); }, [active]);
  useGSAP(() => {
    const element = host.current;
    if (!shown || !element) return;
    const card = element.querySelector(".ga-big-intro-card");
    if (!motionOk()) {
      const timer = window.setTimeout(() => setShown(false), (HOLD + 0.8) * 1000);
      return () => window.clearTimeout(timer);
    }
    gsap.timeline({ onComplete: () => setShown(false) })
      .fromTo(element, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" })
      .fromTo(card, { opacity: 0, scale: 0.9, y: 18 }, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: "expo.out" }, 0.05)
      .fromTo(element.querySelectorAll(".ga-big-intro-line"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.12, ease: "power2.out" }, 0.3)
      .to(element, { opacity: 0, duration: 0.45, ease: "power2.in" }, `+=${HOLD}`);
  }, { scope: host, dependencies: [shown] });
  if (!shown) return null;
  return (
    <div ref={host} className="ga-big-intro" role="status" aria-live="polite">
      <div className="ga-big-intro-card">
        <Gamepad2 className="ga-big-intro-icon" size={64} strokeWidth={1.6} aria-hidden="true" />
        <p className="ga-big-intro-eyebrow ga-big-intro-line">{t("bigPictureIntroEyebrow")}</p>
        <h2 className="ga-big-intro-title">{t("bigPictureTitle")}</h2>
        <p className="ga-big-intro-text ga-big-intro-line">{t("bigPictureHint")}</p>
        <p className="ga-big-intro-exit ga-big-intro-line">{t("bigPictureExitBefore")} <MenuKey /> {t("bigPictureExitAfter")}</p>
      </div>
    </div>
  );
}
