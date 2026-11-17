import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { checkParentalPassword } from "./parentalControl";
import { parentalErrorText, useParentalLocked } from "./ParentalControlSection";
import "./mcp-settings.css";

interface McpState { enabled: boolean; running: boolean; port: number; url: string; confirm: boolean; developer: boolean; error: string }
interface McpClient { id: string; name: string; found: boolean; configured: boolean; path: string; snippet: string }
type Status = { tone: "ok" | "warn" | "error"; text: string } | null;

const hasTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Settings › AI control: Game Access as an MCP server for the player's own AI (mcp_server.rs, src/mcp). The switch,
 * the question before big actions, and each AI app on this PC with Set up / Remove / Copy (mcp_clients.rs). With
 * parental control on, turning it on needs the parent's password.
 */
export default function McpSettings() {
  const { t } = useI18n();
  const locked = useParentalLocked();
  const [state, setState] = useState<McpState | null>(null);
  const [clients, setClients] = useState<McpClient[]>([]);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [copied, setCopied] = useState("");

  const refresh = useCallback(async () => {
    if (!hasTauri()) { setState({ enabled: false, running: false, port: 38160, url: "http://127.0.0.1:38160/mcp", confirm: true, developer: false, error: "" }); return; }
    setState(await invoke<McpState>("mcp_state"));
    setClients(await invoke<McpClient[]>("mcp_clients").catch(() => []));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (work: () => Promise<Status | void>) => {
    setBusy(true); setStatus(null);
    try { const next = await work(); if (next) setStatus(next); }
    catch (error) { setStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); void refresh(); }
  };

  const toggle = (enabled: boolean) => run(async () => {
    if (enabled && locked) {
      try { await checkParentalPassword(password); } catch (error) { return { tone: "error", text: parentalErrorText(error, t) }; }
      setPassword("");
    }
    const next = await invoke<McpState>("mcp_set_enabled", { enabled });
    if (enabled && next.error) return { tone: "error", text: t("mcpPortError", { error: next.error }) };
  });
  const setConfirm = (confirm: boolean) => run(async () => { await invoke("mcp_set_confirm", { confirm }); });
  const setDeveloper = (developer: boolean) => run(async () => { await invoke("mcp_set_developer", { developer }); });
  const setup = (client: McpClient, add: boolean) => run(async () => {
    await invoke("mcp_client_setup", { id: client.id, add });
    return { tone: "ok", text: t(add ? "mcpSetupDone" : "mcpRemoved", { name: client.name }) };
  });
  const copy = async (client: McpClient) => {
    try { await navigator.clipboard.writeText(client.snippet); setCopied(client.id); setStatus({ tone: "ok", text: t("mcpCopied") }); }
    catch (error) { setStatus({ tone: "error", text: String(error) }); }
  };

  if (!state) return null;
  const on = state.enabled && state.running;
  return <section className="ga-mcp-settings ga-stack">
    <p className="ga-hint">{t("mcpHint")}</p>
    <div className="ga-settings-group ga-mcp-card">
      <div className="ga-mcp-text">
        <span className="ga-label">{t("mcpTitle")}</span>
        <p role="status" className={`ga-status ${on ? "is-ok" : state.enabled ? "is-error" : "is-warn"}`}>
          {on ? t("mcpOn") : state.enabled ? t("mcpPortError", { error: state.error }) : t("mcpOff")}
        </p>
      </div>
      <div className="ga-mcp-actions">
        {state.enabled
          ? <GaButton disabled={busy} onClick={() => void toggle(false)}>{t("mcpTurnOff")}</GaButton>
          : <GaButton variant="primary" disabled={busy || (locked && !password)} onClick={() => void toggle(true)}>{t("mcpTurnOn")}</GaButton>}
      </div>
      {!state.enabled && locked ? <label className="ga-field ga-mcp-password"><span>{t("mcpParentLocked")}</span>
        <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && password) void toggle(true); }} /></label> : null}
    </div>

    {state.enabled ? <>
      <div className="ga-settings-group ga-mcp-card">
        <div className="ga-mcp-text">
          <span className="ga-label">{t("mcpConfirmTitle")}</span>
          <p className={`ga-status ${state.confirm ? "is-ok" : "is-warn"}`}>{t(state.confirm ? "mcpConfirmOn" : "mcpConfirmOff")}</p>
        </div>
        <div className="ga-mcp-actions">
          <button type="button" className="ga-settings-choice" aria-pressed={state.confirm} disabled={busy} onClick={() => void setConfirm(true)}>{t("mcpConfirmAsk")}</button>
          <button type="button" className="ga-settings-choice" aria-pressed={!state.confirm} disabled={busy} onClick={() => void setConfirm(false)}>{t("mcpConfirmTrust")}</button>
        </div>
      </div>

      <div className="ga-settings-group ga-mcp-card">
        <div className="ga-mcp-text">
          <span className="ga-label">{t("mcpDevTitle")}</span>
          <p className={`ga-status ${state.developer ? "is-warn" : ""}`}>{t(state.developer ? "mcpDevOn" : "mcpDevOff")}</p>
        </div>
        <div className="ga-mcp-actions">
          {state.developer
            ? <GaButton disabled={busy} onClick={() => void setDeveloper(false)}>{t("mcpTurnOff")}</GaButton>
            : <GaButton disabled={busy || locked} onClick={() => void setDeveloper(true)}>{t("mcpTurnOn")}</GaButton>}
        </div>
      </div>

      <div className="ga-stack">
        <h3 className="ga-heading ga-mcp-title">{t("mcpClientsTitle")}</h3>
        <p className="ga-hint">{t("mcpClientsHint")}</p>
        <ul className="ga-mcp-clients">
          {clients.map(client => <li key={client.id} className="ga-settings-group ga-mcp-card">
            <div className="ga-mcp-text">
              <span className="ga-label">{client.name}</span>
              <p className={`ga-status ${client.configured ? "is-ok" : client.found ? "is-warn" : ""}`}>
                {client.configured ? <Check size={14} aria-hidden="true" /> : null}
                {t(client.configured ? "mcpClientReady" : client.found ? "mcpClientFound" : "mcpClientMissing")}
              </p>
            </div>
            <div className="ga-mcp-actions">
              <GaButton icon={<Copy size={16} aria-hidden="true" />} onClick={() => void copy(client)}>{t(copied === client.id ? "mcpCopiedShort" : "mcpCopy")}</GaButton>
              {client.configured
                ? <GaButton disabled={busy} onClick={() => void setup(client, false)}>{t("mcpRemove")}</GaButton>
                : <GaButton variant="primary" disabled={busy || !client.found} onClick={() => void setup(client, true)}>{t("mcpSetup")}</GaButton>}
            </div>
          </li>)}
        </ul>
        <p className="ga-hint">{t("mcpTryHint")}</p>
      </div>
    </> : null}
    {status ? <p role="status" className={`ga-status is-${status.tone}`}>{status.text}</p> : null}
  </section>;
}
