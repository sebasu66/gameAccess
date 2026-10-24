import { useEffect, useState } from "react";

import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import type { CatalogGame } from "./types";
import { GaClose } from "./components/ga/Buttons";
import { localizeLauncherText } from "./launcherText";

const copy = {
  es: { title: "Registro del juego", empty: "Todavía no hay pasos registrados para este juego.", loading: "Leyendo registro…", close: "Cerrar", hint: "Guardado en la carpeta del juego (gameaccess-log.txt)." },
  en: { title: "Game log", empty: "No steps have been recorded for this game yet.", loading: "Reading log…", close: "Close", hint: "Stored in the game folder (gameaccess-log.txt)." },
};

export default function DigitalGameLog({ game, onClose }: { game: CatalogGame; onClose: () => void }) {
  const { locale } = useI18n(); const c = copy[locale] ?? copy.es;
  const ref = useDialogFocus(onClose);
  const [text, setText] = useState<string | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void digitalProcessManager.gameLog(game).then(result => { if (live) setText(localizeLauncherText(result.log ?? "")); })
      .catch(failure => { if (live) { setError(String(failure)); setText(""); } });
    return () => { live = false; };
  }, [game.app_id, game.id]);
  return <div className="ga-settings-backdrop" onPointerDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className="ga-settings-panel ga-game-config" role="dialog" aria-modal="true" aria-labelledby="game-log-title">
      <header><div><span className="eyebrow">{game.name}</span><h2 id="game-log-title">{c.title}</h2></div>
        <GaClose label={c.close} onClick={onClose} data-dialog-initial /></header>
      <div className="ga-settings-content">
        {text === null ? <p role="status">{c.loading}</p> : text ? <pre className="ga-game-log" tabIndex={-1}>{text}</pre> : <p>{c.empty}</p>}
        {error ? <p className="ga-settings-error" role="alert">{error}</p> : null}
        <p>{c.hint}</p>
      </div>
    </section>
  </div>;
}
