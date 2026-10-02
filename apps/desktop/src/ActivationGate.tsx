import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, KeyRound, Loader2, PlayCircle } from "lucide-react";
import SplashScreen from "./SplashScreen";
import { ACTIVATION_INVALID_EVENT, checkActivation, clearActivationSession, readActivationSession, redeemActivation } from "./activation";
import type { ActivationStatus } from "./activation";
import { useI18n } from "./i18n";

// All of these active titles were checked against the local GameAccess catalog.
// The access gate cannot fetch the protected catalog before a key is redeemed.
const featuredGames = [
  { appId: 2669320, name: "EA SPORTS FC 25" },
  { appId: 292030, name: "The Witcher 3" },
  { appId: 2483190, name: "Forza Horizon 6", imageUrl: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2483190/a3f1465050b6103274991a29b7462d3f28918b5d/header_alt_assets_4.jpg?t=1788887415" },
  { appId: 418370, name: "Resident Evil 7" },
  { appId: 275850, name: "No Man's Sky" },
  { appId: 1086940, name: "Baldur's Gate 3" },
  { appId: 1091500, name: "Cyberpunk 2077" },
  { appId: 1174180, name: "Red Dead Redemption 2" },
  { appId: 1245620, name: "Elden Ring" },
  { appId: 934700, name: "Dead Island 2" },
  { appId: 1551360, name: "Forza Horizon 5" },
  { appId: 381210, name: "Dead by Daylight" },
  { appId: 990080, name: "Hogwarts Legacy" },
  { appId: 108600, name: "Project Zomboid" },
  { appId: 1888930, name: "The Last of Us Part I" },
  { appId: 534380, name: "Dying Light 2" },
  { appId: 870780, name: "Control" },
  { appId: 1593500, name: "God of War" },
  { appId: 1716740, name: "Starfield" },
  { appId: 814380, name: "Sekiro" },
];

const showcaseGames = Array.from({ length: 6 }, () => featuredGames).flat();

const linkvertiseUrl = import.meta.env.VITE_LINKVERTISE_URL?.trim() || "";
const tutorialVideoUrl = import.meta.env.VITE_LINKVERTISE_HELP_VIDEO_URL?.trim() || "";

export default function ActivationGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [splashComplete, setSplashComplete] = useState(false);
  const [helpOpen, setHelpOpen] = useState(() => window.location.hash === "#obtener-clave");

  const completeSplash = useCallback(() => setSplashComplete(true), []);

  const verify = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const token = await readActivationSession();
      if (!token) { setStatus(null); return; }
      setStatus(await checkActivation(token));
    } catch (reason) {
      setStatus(null);
      setError(reason instanceof Error ? reason.message : t("activationVerifyFailed"));
    } finally { setBusy(false); }
  }, [t]);

  useEffect(() => { void verify(); }, [verify]);
  useEffect(() => {
    const syncHelpPage = () => setHelpOpen(window.location.hash === "#obtener-clave");
    window.addEventListener("hashchange", syncHelpPage);
    return () => window.removeEventListener("hashchange", syncHelpPage);
  }, []);
  useEffect(() => {
    const invalid = () => {
      setStatus(null);
      setNotice("");
      setError(t("activationExpiredHelp"));
      void clearActivationSession();
    };
    window.addEventListener(ACTIVATION_INVALID_EVENT, invalid);
    return () => window.removeEventListener(ACTIVATION_INVALID_EVENT, invalid);
  }, [t]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible") void verify(); };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [verify]);
  useEffect(() => {
    if (!status) return;
    setNotice("");
    const remaining = Date.parse(status.expires_at) - Date.parse(status.server_time);
    const warningDelay = remaining - 10 * 60 * 1000;
    let warningTimer: number | undefined;
    if (warningDelay <= 0 && remaining > 0) {
      setNotice(t("activationExpiringSoon"));
    } else if (warningDelay > 0) {
      warningTimer = window.setTimeout(() => setNotice(t("activationExpiringSoon")), warningDelay);
    }
    const expiryTimer = window.setTimeout(() => {
      setStatus(null);
      setNotice("");
      setError(t("activationTimeEnded"));
      void clearActivationSession();
    }, Math.max(0, remaining));
    return () => {
      if (warningTimer != null) window.clearTimeout(warningTimer);
      window.clearTimeout(expiryTimer);
    };
  }, [status, t]);

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError("");
    try {
      setStatus(await redeemActivation(key));
      setKey("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("activationKeyFailed"));
    } finally { setBusy(false); }
  };

  return <>
    {status?.active ? <>
      {children}
      {notice ? <div className="toast" role="status" aria-live="assertive">{notice}</div> : null}
    </> : <main className="runtime-gate activation-gate">
      <div className="activation-showcase" aria-hidden="true">
        <div className="activation-showcase-grid">
          {showcaseGames.map((game, index) => <div className="activation-showcase-cover" key={index}>
            <img src={"imageUrl" in game ? game.imageUrl : `https://cdn.akamai.steamstatic.com/steam/apps/${game.appId}/library_600x900.jpg`} alt="" draggable={false} />
            {"imageUrl" in game ? <strong>{game.name}</strong> : null}
          </div>)}
        </div>
      </div>
      {helpOpen ? <section className="runtime-gate-card activation-card activation-help" aria-labelledby="activation-help-title">
        <a className="activation-back" href="#acceso"><ArrowLeft size={18} /> {t("activationBack")}</a>
        <div className="activation-card-heading"><div className="activation-key-mark"><PlayCircle size={24} /></div><span className="eyebrow">{t("activationFree")}</span></div>
        <h1 id="activation-help-title">{t("activationHelpTitle")}</h1>
        <p>{t("activationHelpLead")}</p>
        {tutorialVideoUrl ? <video className="activation-help-video" controls playsInline src={tutorialVideoUrl} aria-label={t("activationHelpVideo")} />
          : <div className="activation-video-pending"><PlayCircle size={38} /><span>{t("activationVideoPending")}</span></div>}
        <ol className="activation-help-steps"><li>{t("activationStep1")}</li><li>{t("activationStep2")}</li><li>{t("activationStep3")}</li></ol>
        {linkvertiseUrl ? <a className="activation-provider-link" href={linkvertiseUrl} target="_blank" rel="noopener noreferrer">{t("activationGoLinkvertise")} <ArrowUpRight size={19} /></a>
          : <p className="activation-provider-pending">{t("activationLinkPending")}</p>}
      </section> : <section className="runtime-gate-card activation-card">
        <div className="activation-card-heading"><div className="activation-key-mark"><KeyRound size={24} /></div><span className="eyebrow">{t("activationBeta")}</span></div>
        <h1>{busy ? t("activationChecking") : t("activationEnter")}</h1>
        <p>{t("activationLead")}</p>
        <form onSubmit={event => void activate(event)} className="activation-form">
          <label htmlFor="activation-key">{t("activationKeyLabel")}</label>
          <input id="activation-key" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder={t("activationKeyPlaceholder")} disabled={busy} />
          {error ? <p role="alert" className="activation-error">{error}</p> : null}
          {error && !key.trim() ? <button type="button" className="activation-retry" onClick={() => void verify()} disabled={busy}>{t("retryConnection")}</button> : null}
          <div className="runtime-gate-actions">
            <button type="submit" className="primary" disabled={busy || !key.trim()}>{busy ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />} {t("activationSubmit")}</button>
          </div>
        </form>
        <a className="activation-free-link" href="#obtener-clave">{t("activationGetFree")} <ArrowUpRight size={18} /></a>
      </section>}
    </main>}
    {!splashComplete ? <SplashScreen onComplete={completeSplash} /> : null}
  </>;
}
