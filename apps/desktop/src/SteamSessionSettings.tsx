import { useEffect, useMemo, useState } from "react";
import { Check, KeyRound, Loader2, Settings, ShieldCheck, Trash2, X } from "lucide-react";

import {
  getLocalSteamPool,
  getSteamSessionStatus,
  hasSteamCredential,
  hasTauriRuntime,
  removeSteamCredential,
  saveSteamCredential,
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
  const [enrolled, setEnrolled] = useState<Record<string, boolean>>({});
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<SteamSessionStatus | null>(null);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let cancelled = false;
    const loadAccounts = async () => {
      const pool = await getLocalSteamPool();
      const next = pool?.accounts ?? [];
      const credentialFlags = await Promise.all(next.map(async (account) => {
        const name = steamAccountName(account);
        return [name, name ? await hasSteamCredential(name) : false] as const;
      }));
      if (!cancelled) {
        setAccounts(next);
        setEnrolled(Object.fromEntries(credentialFlags));
      }
    };
    void loadAccounts().catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

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
    setMessage("Preferencias de sesión guardadas.");
  };

  const enroll = async (account: LocalSteamAccount) => {
    const name = steamAccountName(account);
    const password = passwords[name] ?? "";
    if (!name || !password) {
      setMessage("Ingresá la contraseña de Steam para esta cuenta.");
      return;
    }
    setBusyAccount(name);
    setMessage(null);
    try {
      await saveSteamCredential(name, password);
      setPasswords((current) => ({ ...current, [name]: "" }));
      setEnrolled((current) => ({ ...current, [name]: true }));
      setMessage(`${account.label}: inicio directo configurado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAccount(null);
    }
  };

  const forget = async (account: LocalSteamAccount) => {
    const name = steamAccountName(account);
    if (!name) return;
    setBusyAccount(name);
    try {
      await removeSteamCredential(name);
      setEnrolled((current) => ({ ...current, [name]: false }));
      setMessage(`${account.label}: contraseña eliminada de GameAccess.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAccount(null);
    }
  };

  if (!hasTauriRuntime()) return null;

  return (
    <>
      {activeSession ? (
        <output className="steam-session-chip">
          <Loader2 size={15} className={activeSession.phase === "running" ? "" : "spin"} />
          <span>{activeSession.phase === "running" ? `Jugando · AppID ${activeSession.appId}` : activeSession.message}</span>
        </output>
      ) : null}

      <button type="button" className="steam-settings-fab" onClick={() => setOpen(true)} aria-label="Configuración de Steam">
        <Settings size={20} />
      </button>

      {open ? (
        <div className="steam-settings-backdrop">
          <button type="button" className="steam-settings-backdrop-dismiss" onClick={() => setOpen(false)} aria-label="Cerrar configuración de Steam" />
          <section className="steam-settings-panel" role="dialog" aria-modal="true" aria-label="Configuración de sesiones Steam">
            <header>
              <div>
                <span className="eyebrow">STEAM SESSION MANAGER</span>
                <h2>Cuentas y retorno automático</h2>
                <p>GameAccess puede cerrar Steam, iniciar la cuenta propietaria, ejecutar el juego y restaurar tu cuenta al salir.</p>
              </div>
              <button type="button" className="steam-settings-close" onClick={() => setOpen(false)} aria-label="Cerrar"><X size={20} /></button>
            </header>

            <div className="steam-settings-section">
              <h3>Después de jugar</h3>
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
                      {account.label}{account.active ? " · activa" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="steam-settings-section">
              <div className="steam-section-title">
                <div><h3>Inicio directo</h3><p>Guardá una vez la contraseña de cada cuenta que quieras cambiar sin interacción.</p></div>
                <ShieldCheck size={22} />
              </div>
              <div className="steam-account-list">
                {accounts.map((account) => {
                  const name = steamAccountName(account);
                  const isEnrolled = Boolean(enrolled[name]);
                  const isBusy = busyAccount === name;
                  return (
                    <article className="steam-account-row" key={account.steam_id64 || name}>
                      <div className="steam-account-copy">
                        <strong>{account.label}</strong>
                        <span>{name || "Cuenta sin nombre"}{account.active ? " · activa ahora" : ""}</span>
                      </div>
                      {isEnrolled ? (
                        <div className="steam-account-actions enrolled">
                          <span className="steam-enrolled"><Check size={14} /> Inicio directo listo</span>
                          <button type="button" onClick={() => void forget(account)} disabled={isBusy} aria-label={`Olvidar contraseña de ${account.label}`}><Trash2 size={16} /></button>
                        </div>
                      ) : (
                        <div className="steam-account-actions">
                          <input
                            type="password"
                            autoComplete="current-password"
                            placeholder="Contraseña Steam"
                            value={passwords[name] ?? ""}
                            onChange={(event) => setPasswords((current) => ({ ...current, [name]: event.target.value }))}
                            onKeyDown={(event) => { if (event.key === "Enter") void enroll(account); }}
                          />
                          <button type="button" className="steam-enroll-button" onClick={() => void enroll(account)} disabled={isBusy || !name}>
                            {isBusy ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />} Guardar
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
                {!accounts.length ? <p className="steam-settings-empty">Todavía no se detectaron cuentas Steam recordadas en esta PC.</p> : null}
              </div>
            </div>

            <footer>
              <p>Las contraseñas se cifran con Windows DPAPI para el usuario actual. No se guardan en la base de datos ni en localStorage.</p>
              {message ? <span className="steam-settings-message">{message}</span> : null}
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
