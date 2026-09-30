import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, KeyRound, Loader2, PlayCircle } from "lucide-react";
import SplashScreen from "./SplashScreen";
import { ACTIVATION_INVALID_EVENT, checkActivation, clearActivationSession, readActivationSession, redeemActivation } from "./activation";
import type { ActivationStatus } from "./activation";

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
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
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
      setError(reason instanceof Error ? reason.message : "No se pudo verificar la activación.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void verify(); }, [verify]);
  useEffect(() => {
    const syncHelpPage = () => setHelpOpen(window.location.hash === "#obtener-clave");
    window.addEventListener("hashchange", syncHelpPage);
    return () => window.removeEventListener("hashchange", syncHelpPage);
  }, []);
  useEffect(() => {
    const invalid = () => {
      setStatus(null);
      setError("La activación venció o fue revocada. Volvé a verificar o ingresá otra clave.");
      void clearActivationSession();
    };
    window.addEventListener(ACTIVATION_INVALID_EVENT, invalid);
    return () => window.removeEventListener(ACTIVATION_INVALID_EVENT, invalid);
  }, []);
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
    const remaining = Date.parse(status.expires_at) - Date.parse(status.server_time);
    const timeout = window.setTimeout(() => void verify(), Math.max(1000, Math.min(remaining, 24 * 60 * 60 * 1000)));
    return () => window.clearTimeout(timeout);
  }, [status, verify]);

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError("");
    try {
      setStatus(await redeemActivation(key));
      setKey("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo validar la clave de acceso.");
    } finally { setBusy(false); }
  };

  return <>
    {status?.active ? children : <main className="runtime-gate activation-gate">
      <div className="activation-showcase" aria-hidden="true">
        <div className="activation-showcase-grid">
          {showcaseGames.map((game, index) => <div className="activation-showcase-cover" key={index}>
            <img src={"imageUrl" in game ? game.imageUrl : `https://cdn.akamai.steamstatic.com/steam/apps/${game.appId}/library_600x900.jpg`} alt="" draggable={false} />
            {"imageUrl" in game ? <strong>{game.name}</strong> : null}
          </div>)}
        </div>
      </div>
      {helpOpen ? <section className="runtime-gate-card activation-card activation-help" aria-labelledby="activation-help-title">
        <a className="activation-back" href="#acceso"><ArrowLeft size={18} /> Volver a ingresar la clave</a>
        <div className="activation-card-heading"><div className="activation-key-mark"><PlayCircle size={24} /></div><span className="eyebrow">ACCESO GRATIS</span></div>
        <h1 id="activation-help-title">Cómo obtener tu clave de acceso</h1>
        <p>Completá el recorrido indicado y volvé a Game Access para ingresar la clave que recibas.</p>
        {tutorialVideoUrl ? <video className="activation-help-video" controls playsInline src={tutorialVideoUrl} aria-label="Video: cómo obtener tu clave de acceso" />
          : <div className="activation-video-pending"><PlayCircle size={38} /><span>El video explicativo estará disponible acá.</span></div>}
        <ol className="activation-help-steps"><li>Abrí el enlace de Linkvertise.</li><li>Completá los pasos que te indique la página.</li><li>Copiá la clave y pegala en Game Access.</li></ol>
        {linkvertiseUrl ? <a className="activation-provider-link" href={linkvertiseUrl} target="_blank" rel="noopener noreferrer">Ir a Linkvertise <ArrowUpRight size={19} /></a>
          : <p className="activation-provider-pending">El enlace para obtener claves gratis todavía no está disponible.</p>}
      </section> : <section className="runtime-gate-card activation-card">
        <div className="activation-card-heading"><div className="activation-key-mark"><KeyRound size={24} /></div><span className="eyebrow">ACCESO BETA</span></div>
        <h1>{busy ? "Verificando acceso…" : "Entrá a Game Access"}</h1>
        <p>Ingresá tu clave de acceso para empezar a jugar.</p>
        <form onSubmit={event => void activate(event)} className="activation-form">
          <label htmlFor="activation-key">Clave de acceso</label>
          <input id="activation-key" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Pegá tu clave acá" disabled={busy} />
          {error ? <p role="alert" className="activation-error">{error}</p> : null}
          {error && !key.trim() ? <button type="button" className="activation-retry" onClick={() => void verify()} disabled={busy}>Reintentar conexión</button> : null}
          <div className="runtime-gate-actions">
            <button type="submit" className="primary" disabled={busy || !key.trim()}>{busy ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />} Acceder a los juegos</button>
          </div>
        </form>
        <a className="activation-free-link" href="#obtener-clave">Obtener clave de acceso gratis <ArrowUpRight size={18} /></a>
      </section>}
    </main>}
    {(!status?.active || !splashComplete) ? <SplashScreen onComplete={completeSplash} /> : null}
  </>;
}
