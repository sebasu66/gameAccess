import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import AutomationForm from "./AutomationForm";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { emptyAutomation, loadAutomation, saveAutomation, type AutomationFields } from "./catalog/ExecutionProfiles";
import type { CatalogGame } from "./types";

export type RecoveryMode = "error" | "broken";

const BROKEN_INSTALL = /ejecutable|no esta descargado|no está descargado|no existe la carpeta/i;
/** True when a failed Play means the files on disk are not a runnable game. */
export const isBrokenInstall = (message: string) => BROKEN_INSTALL.test(message);

/** The file a failed step was working on, taken from messages like "error intentando descomprimir X.rar: ...". */
export function fileInProgress(message: string): string {
  return /(?:descomprimir|instalar|extrayendo|extraer)\s+(.+?)(?::|$)/i.exec(message)?.[1]?.trim() ?? "";
}

export function suggestionFor(message: string, mode: RecoveryMode, locale: "es" | "en"): string {
  const es = locale === "es";
  if (mode === "broken") return es ? "Probá con otros archivos a ejecutar o reinstalá el juego." : "Try other files to run, or reinstall the game.";
  const text = message.toLowerCase();
  if (/404|410|sin semillas|no seeds|no hay semillas|metadata|enlace ca[ií]do|expir/.test(text)) return es ? "Intentá otra fuente disponible." : "Try another available source.";
  if (/descomprimir|extra/.test(text)) return es ? "Revisá el archivo y la contraseña, corregí los parámetros y reintentá." : "Check the file and password, fix the parameters and retry.";
  if (/instalar|instalador/.test(text)) return es ? "Probá ejecutar como administrador o cambiá el modo del instalador, y reintentá." : "Try running as administrator or change the installer mode, then retry.";
  return es ? "Reintentá; si vuelve a fallar, probá otra fuente." : "Retry; if it fails again, try another source.";
}

const copy = {
  es: { error: "No se pudo completar", broken: "El juego parece mal instalado", file: "Archivo en proceso", suggestion: "Qué probar", params: "Parámetros de automatización",
    retry: "Intentar de nuevo", repair: "Reparar automáticamente", repaired: "Listo: el juego está preparado para ejecutarse.", abort: "Cancelar y abortar todo", reinstall: "Reinstalar", remove: "Borrar el juego", close: "Cerrar", working: "Trabajando…", saved: "Parámetros guardados." },
  en: { error: "Could not complete", broken: "The game looks badly installed", file: "File being processed", suggestion: "What to try", params: "Automation parameters",
    retry: "Try again", repair: "Repair automatically", repaired: "Done: the game is ready to run.", abort: "Cancel and abort everything", reinstall: "Reinstall", remove: "Delete the game", close: "Close", working: "Working…", saved: "Parameters saved." },
};

export default function GameRecoveryDialog({ game, mode, message, onClose }: { game: CatalogGame; mode: RecoveryMode; message: string; onClose: () => void }) {
  const { locale } = useI18n(); const c = copy[locale] ?? copy.es;
  const ref = useDialogFocus(onClose);
  const appId = game.app_id ?? game.id;
  const [automation, setAutomation] = useState<AutomationFields>(emptyAutomation);
  const [archives, setArchives] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [note, setNote] = useState(""); const [failure, setFailure] = useState("");
  useEffect(() => {
    let live = true;
    void loadAutomation(appId).then(found => { if (live) setAutomation(found); });
    void digitalProcessManager.gameOptions(game).then(result => { if (live) setArchives(result.archives ?? []); }).catch(() => undefined);
    return () => { live = false; };
  }, [appId]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setFailure(""); setNote(c.working);
    try { await saveAutomation(appId, automation); await action(); onClose(); }
    catch (error) { setFailure(String(error instanceof Error ? error.message : error)); setNote(""); }
    finally { setBusy(false); }
  };
  const abort = () => run(async () => { await digitalDownloadService.cancel(appId).catch(() => undefined); await digitalProcessManager.executeUninstall(game); });
  const retry = () => run(async () => { await digitalDownloadService.start(game); });
  const reinstall = () => run(async () => { await digitalProcessManager.executeUninstall(game); await digitalDownloadService.start(game); });
  const repair = async () => {
    setBusy(true); setFailure(""); setNote(c.working);
    try {
      await saveAutomation(appId, automation);
      const result = await digitalProcessManager.repairGame(game);
      setNote(result.analysis?.ready ? c.repaired : "");
    } catch (error) { setFailure(String(error instanceof Error ? error.message : error)); setNote(""); }
    finally { setBusy(false); }
  };
  const file = fileInProgress(message);
  return <div className="ga-settings-backdrop" onPointerDown={event => event.stopPropagation()}>
    <section ref={ref} className="ga-settings-panel ga-game-config" role="alertdialog" aria-modal="true" aria-labelledby="game-recovery-title">
      <header><div><span className="eyebrow">{game.name}</span><h2 id="game-recovery-title">{mode === "broken" ? c.broken : c.error}</h2></div></header>
      <div className="ga-settings-content">
        <p className="ga-settings-error" role="alert">{message}</p>
        {file ? <p><strong>{c.file}:</strong> {file}</p> : null}
        <p><strong>{c.suggestion}:</strong> {suggestionFor(message, mode, locale)}</p>
        <h3>{c.params}</h3>
        <AutomationForm value={automation} onChange={setAutomation} archives={archives} disabled={busy} />
        {note ? <p role="status">{note}</p> : null}{failure ? <p className="ga-settings-error" role="alert">{failure}</p> : null}
      </div>
      <footer>
        <button type="button" disabled={busy} onClick={onClose} data-dialog-initial>{c.close}</button>
        <button type="button" disabled={busy} onClick={() => void repair()}>{c.repair}</button>
        {mode === "broken"
          ? <><button type="button" disabled={busy} onClick={() => void abort()}>{c.remove}</button><button type="button" disabled={busy} onClick={() => void reinstall()}>{c.reinstall}</button></>
          : <><button type="button" disabled={busy} onClick={() => void abort()}>{c.abort}</button><button type="button" disabled={busy} onClick={() => void retry()}>{c.retry}</button></>}
      </footer>
    </section>
  </div>;
}
