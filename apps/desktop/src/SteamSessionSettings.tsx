import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, RefreshCw, Settings, ShieldCheck, X } from "lucide-react";

import {
  getLocalSteamPool,
  getSteamSessionStatus,
  hasTauriRuntime,
  type LocalSteamAccount,
  type SteamSessionStatus,
} from "./native";
import {
  loadSteamSessionPreferences,
  saveSteamSessionPreferences,
  type SteamRestoreMode,
  type SteamSessionPreferences,
} from "./steamSessionPreferences";

function steamAccountName(account: LocalSteamAccount): string {
  return (account.account_name || account.label || "").trim();
}

function restoreDescription(mode: SteamRestoreMode): string {
  if (mode === "main") return "Al cerrar el juego, GameAccess vuelve siempre a tu cuenta principal.";
  if (mode === "previous") return "Al cerrar el juego, GameAccess intenta volver a la cuenta que estabas usando antes.";
  return "Steam queda en la cuenta usada para ejecutar el juego.";
}

export default function SteamSessionSettings() {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<LocalSteamAccount[]>([]);
  const [preferences, setPreferences] = useState<SteamSessionPreferences>(() => loadSteamSessionPreferences());
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<SteamSessionStatus | null>(null);

  const refreshAccounts = useCallback(async () => {
    if (!hasTauriRuntime()) return;
    setLoadingAccounts(true);
    try {
      const pool = await getLocalSteamPool();
      setAccounts(pool?.accounts ?? []);
      setMessage(pool?.accounts?.length
        ? `${pool.accounts.length} cuentas recordadas por Steam detectadas.`
        : "Steam no tiene cuentas marcadas con Recordarme en esta PC.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getSteamSessionStatus();
        if (!cancelled) setSession(next);
      } catch { /* native session status is best-effort UI */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const mainAccountOptions = useMemo(() => accounts.filter((account) => steamAccountName(account)), [accounts]);
  const activeSession = session && !session.done && session.phase !== "idle" ? session : null;

  const updatePreferences = (next: SteamSessionPreferences) => {
    setPreferences(next);
    saveSteamSessionPreferences(next);
    setMessage("Preferencias de sesi?n guardadas.");
  };

  if (!hasTauriRuntime()) return null;

  return (
    <>
      {activeSession ? (
        <output className="steam-session-chip">
          <Loader2 size={15} className={activeSession.phase === "running" ? "" : "spin"} />
          <span>{activeSession.phase === "running" ? `Jugando ? AppID ${activeSession.appId}` : activeSession.message}</span>
        </output>
      ) : null}

      <button type="button" className="steam-settings-fab" onClick={() => setOpen(true)} aria-label="Configuraci?n de Steam">
        <Settings size={20} />
      </button>

      {open ? (
        <div className="steam-settings-backdrop">
          <button type="button" className="steam-settings-backdrop-dismiss" onClick={() => setOpen(false)} aria-label="Cerrar configuraci?n de Steam" />
          <section className="steam-settings-panel" role="dialog" aria-modal="true" aria-label="Configuraci?n de sesiones Steam">
            <header>
              <div>
                <span className="eyebrow">STEAM SESSION MANAGER</span>
                <h2>Cuentas y retorno autom?tico</h2>
                <p>GameAccess detecta como cuentas personales ?nicamente las que Steam tiene marcadas con Recordarme.</p>
              </div>
              <button type="button" className="steam-settings-close" onClick={() => setOpen(false)} aria-label="Cerrar"><X size={20} /></button>
            </header>

            <div className="steam-settings-section">
              <h3>Despu?s de jugar</h3>
              <div className="steam-restore-options">
                {(["main", "previous", "leave"] as SteamRestoreMode[]).map((mode) => (
                  <label key={mode} className={preferences.restoreMode === mode ? "selected" : ""}>
                    <input
                      type="radio"
                      name="steam-restore-mode"
                      value={mode}
                      checked={preferences.restoreMode === mode}
                      onChange={() => updatePreferences({ ...preferences, restoreMode: mode })}
                    />
                    <span>{mode === "main" ? "Volver a mi cuenta principal" : mode === "previous" ? "Volver a la cuenta anterior" : "Dejar la cuenta del juego"}</span>
                  </label>
                ))}
              </div>
              <p className="steam-settings-help">{restoreDescription(preferences.restoreMode)}</p>

              <label className="steam-main-account-field">
                <span>Cuenta principal</span>
                <select
                  value={preferences.mainAccountName ?? ""}
                  onChange={(event) => updatePreferences({ ...preferences, mainAccountName: event.target.value || null })}
                >
                  <option value="">Sin definir</option>
                  {mainAccountOptions.map((account) => (
                    <option key={account.steam_id64 || steamAccountName(account)} value={steamAccountName(account)}>
                      {account.label}{account.active ? " ? activa" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="steam-settings-section">
              <div className="steam-section-title">
                <div>
                  <h3>Cuentas Steam detectadas</h3>
                  <p>Estas cuentas tienen Recordarme activado en Steam y GameAccess puede volver a ellas sin pedirte la contrase?a.</p>
                </div>
                <ShieldCheck size={22} />
              </div>
              <div className="steam-account-list">
                {accounts.map((account) => {
                  const name = steamAccountName(account);
                  return (
                    <article className="steam-account-row" key={account.steam_id64 || name}>
                      <div className="steam-account-copy">
                        <strong>{account.label}</strong>
                        <span>{name || "Cuenta sin nombre"}{account.active ? " ? activa ahora" : ""}</span>
                      </div>
                      <div className="steam-account-actions enrolled">
                        <span className="steam-enrolled"><Check size={14} /> Inicio autom?tico listo</span>
                      </div>
                    </article>
                  );
                })}
                {!accounts.length && !loadingAccounts ? <p className="steam-settings-empty">No hay cuentas Steam con Recordarme activado en esta PC.</p> : null}
              </div>
              <p className="steam-settings-help">Para agregar otra cuenta, inici? sesi?n manualmente en Steam con esa cuenta y activ? Recordarme. Despu?s puls? Actualizar.</p>
              <button type="button" className="steam-enroll-button" onClick={() => void refreshAccounts()} disabled={loadingAccounts}>
                {loadingAccounts ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Actualizar cuentas
              </button>
            </div>

            <footer>
              <p>GameAccess no solicita ni muestra contrase?as para tus cuentas personales. Steam mantiene la sesi?n recordada en esta PC.</p>
              {message ? <span className="steam-settings-message">{message}</span> : null}
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
