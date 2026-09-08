
import { Check, Gamepad2, Loader2 } from "lucide-react";

import { SessionView } from "./AppPresentation";
export function SessionOverlay({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const active = ["reserving", "preparing", "launching"].includes(session.phase);
  const success = ["playing", "demo-ready"].includes(session.phase);
  return (
    <div className="session-backdrop">
      <section className="session-card" style={session.game.hero_image ? { backgroundImage: `url("${session.game.hero_image}")` } : undefined}>
        <div className="session-shade" />
        <div className="session-content">
          <div className={`session-status-icon ${success ? "success" : session.phase === "error" ? "error" : ""}`}>
            {active ? <Loader2 className="spin" size={28} /> : success ? <Check size={28} /> : <Gamepad2 size={28} />}
          </div>
          <span className="eyebrow">PREPARANDO TU PARTIDA</span>
          <h2>{session.game.name}</h2>
          <h3>{session.title}</h3>
          <p>{session.detail}</p>
          {session.log?.length ? <div className="session-log">{session.log.map((line, index) => <div key={`${index}-${line}`}><span>{String(index + 1).padStart(2, "0")}</span>{line}</div>)}</div> : null}
          <section  className="session-steps" aria-label="Progreso de inicio">
            <span className={session.phase !== "reserving" ? "done" : "current"}>Reserva</span><i />
            <span className={["launching", "playing", "demo-ready", "waiting-adapter"].includes(session.phase) ? "done" : session.phase === "preparing" ? "current" : ""}>Preparación</span><i />
            <span className={success ? "done" : session.phase === "launching" ? "current" : ""}>Juego</span>
          </section>
          {!active ? <button type="button" className="secondary-button session-close" onClick={onClose}>{success ? "Listo" : "Volver al catálogo"}</button> : null}
        </div>
      </section>
    </div>
  );
}

