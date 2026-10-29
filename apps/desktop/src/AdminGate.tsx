import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { loadPixelStyle } from "./pixelStylePreferences";
import { Leaf } from "./SplashScreen";
import AdminKeyField, { useForgotAdminKey } from "./AdminKeyField";
import { IDLE_RELOCK_MS, getAccessRole, getAdminKey, isPlusLapsed, relock, settleGateRequest, useAdminKey, useGateRequest } from "./accessRole";
import "./splash-screen.css";
import "./admin-gate.css";

/**
 * The gate again, after the opening: a player who touches a protected section (accessRole.ts), or an administrator who
 * left the PC alone, sees the cover close and ask for the parent's key with the same field as at the opening. The key
 * unlocks the lock and opens the gate as the administrator; "enter as a player" opens it as it was.
 */
const CLOSE_MS = 1300, TURN_MS = 950, SETTLE_MS = 450;
type Step = "away" | "closing" | "asking" | "unlocking" | "opening";

export default function AdminGate() {
  const { t } = useI18n();
  const asking = useGateRequest();
  const key = useAdminKey();
  const forgot = useForgotAdminKey();
  const [step, setStep] = useState<Step>("away");
  const [unlocked, setUnlocked] = useState(false);
  const reduced = useRef(false);
  const timers = useRef<number[]>([]);
  const later = (run: () => void, ms: number) => { timers.current.push(window.setTimeout(run, ms)); };

  // A request closes the gate: it starts open (out of sight) and slides shut; the field shows once it is shut.
  const current = useRef<Step>("away");
  current.current = step;
  useEffect(() => {
    if (!asking || current.current !== "away") return;
    reduced.current = !loadPixelStyle().animate || matchMedia("(prefers-reduced-motion: reduce)").matches;
    setStep("opening");
    // Two frames out of sight first, so the leaves have somewhere to slide in from.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setStep("closing");
      later(() => setStep("asking"), reduced.current ? 0 : CLOSE_MS);
    }));
  }, [asking]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);

  // PLUS turned out to be off while it waited for the key: it opens by itself.
  useEffect(() => {
    if (!asking && (current.current === "asking" || current.current === "closing")) {
      setStep("opening");
      later(() => { setStep("away"); setUnlocked(false); }, reduced.current ? 0 : CLOSE_MS + 100);
    }
  }, [asking]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (admin: boolean) => {
    setStep("opening");
    later(() => { setStep("away"); setUnlocked(false); settleGateRequest(admin); }, reduced.current ? 0 : CLOSE_MS + 100);
  };
  const unlock = () => { setUnlocked(true); setStep("unlocking"); later(() => finish(true), reduced.current ? 0 : TURN_MS + SETTLE_MS); };

  // The administrator left the PC alone: back to a player, with the gate shut.
  useEffect(() => {
    if (!key.enabled) return;
    let last = Date.now();
    const seen = () => { last = Date.now(); };
    const events = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
    for (const name of events) window.addEventListener(name, seen, { passive: true });
    const timer = window.setInterval(() => {
      if (getAccessRole() === "admin" && !isPlusLapsed() && getAdminKey().enabled && Date.now() - last > IDLE_RELOCK_MS) { last = Date.now(); void relock(); }
    }, 15_000);
    return () => { for (const name of events) window.removeEventListener(name, seen); window.clearInterval(timer); };
  }, [key.enabled]);

  if (step === "away") return null;
  const sealed = !unlocked;
  const cls = `gameaccess-splash gs-gate gs-admin-gate${step === "opening" ? " is-opening" : ""}${sealed ? " is-sealed" : " is-unlocking"}${reduced.current ? " gs-reduced" : ""}`;
  return <div className={cls} role="dialog" aria-modal="true" aria-label={t("adminKeyGateLabel")}
    style={{ "--gs-draw": "0ms", "--gs-turn": `${TURN_MS}ms`, "--gs-open": `${CLOSE_MS}ms` } as React.CSSProperties}>
    <Leaf side="left">{step === "asking" ? <AdminKeyField length={key.length} onSuccess={unlock} onPlayer={() => finish(false)} onForgot={forgot} /> : null}</Leaf>
    <Leaf side="right" />
  </div>;
}

