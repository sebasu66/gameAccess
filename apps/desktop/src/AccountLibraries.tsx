/**
 * Library › Manager › Accounts: the user's account libraries (apps/launcher/account_registry.py). Each account the
 * user registers by signing in on the store's own page brings its whole library, synced on its own; games are never
 * added or taken out one by one, and removing the account takes its whole library out (Steam and the games on disk
 * are not touched). Steam today; Epic, GOG and Xbox later. The accounts this PC's Steam remembers are offered as
 * suggestions, never added alone. No Game Access user is needed: the list lives on this PC.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, LogIn, RefreshCw, Trash2 } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { confirmNotice, hideNotice } from "./notice/notice";
import { useI18n, type TranslationKey } from "./i18n";
import { linkSteamAccount, removeSteamAccount, steamStatus, syncSteamLibrary, type SteamLinkStatus, type SteamStatus } from "./steamLibrary";
import { uiDemo } from "./devDemo/uiDemo";
import "./account-libraries.css";

/** The browser preview (`?uiDemo=1`): two registered accounts, one private, and one suggestion. */
const DEMO_STATUS: SteamStatus = {
  found: true, path: "C:\\Program Files (x86)\\Steam", active_id64: "76561198000000001", libraries: ["C:\\Program Files (x86)\\Steam", "F:\\SteamLibrary"],
  installed_count: 14, owned_count: 212, owned_fetched_at: Date.now() / 1000 - 3600, settings: { auto_import: true, switch_accounts: true },
  accounts: [
    { steam_id64: "76561198000000001", account_id: 39734273, account_name: "importech_cba", persona_name: "blackzillatron", remembered: true, active: true, owned_count: 187, installed_count: 12, private: false, error: "" },
    { steam_id64: "76561198000000002", account_id: 39734274, account_name: "", persona_name: "Sofi", remembered: false, active: false, owned_count: 0, installed_count: 2, private: true, error: "" },
  ],
  suggestions: [{ steam_id64: "76561198000000003", account_name: "lan_party", persona_name: "LAN" }],
};

export default function AccountLibraries() {
  const { t, locale } = useI18n();
  const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const demo = !native && uiDemo();
  const [status, setStatus] = useState<SteamStatus | null>(demo ? DEMO_STATUS : null);
  const [linking, setLinking] = useState<string | null>(null);   // "" any account, or the suggested one's name
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const load = () => steamStatus().then(setStatus).catch(failure => setSaid({ tone: "error", text: String(failure) }));
  useEffect(() => { if (native) void load(); return () => abort.current?.abort(); }, [native]);

  const LINK_SAID: Record<Exclude<SteamLinkStatus, "pending">, { tone: "ok" | "warn" | "error"; key: TranslationKey }> = {
    done: { tone: "ok", key: "acctLinkDone" }, cancelled: { tone: "warn", key: "acctLinkCancelled" },
    failed: { tone: "error", key: "acctLinkFailed" }, expired: { tone: "warn", key: "acctLinkExpired" },
  };
  /**
   * What went wrong, in words the player can act on (Seba, 2026-11-16: the buttons "did nothing"). The server without
   * the sign-in (404, an older server) and no connection are told apart; anything else keeps its own message.
   */
  const failureText = (failure: unknown) => {
    const message = String(failure instanceof Error ? failure.message : failure);
    if (/404|not found/i.test(message)) return t("acctLinkNoServer");
    if (/urlopen|getaddrinfo|timed out|connection|network|fetch/i.test(message)) return t("acctLinkOffline");
    return t("acctLinkError", { error: message });
  };
  const link = async (who = "") => {
    if (!native) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLinking(who); setSaid(null);
    try {
      const outcome = await linkSteamAccount({ signal: controller.signal });
      if (outcome !== "pending") setSaid({ tone: LINK_SAID[outcome].tone, text: t(LINK_SAID[outcome].key) });
      await load();
    } catch (failure) { setSaid({ tone: "error", text: failureText(failure) }); }
    finally { if (abort.current === controller) { abort.current = null; setLinking(null); } }
  };
  const cancel = () => { abort.current?.abort(); abort.current = null; setLinking(null); };
  const remove = async (id64: string, name: string) => {
    const ok = await confirmNotice({ title: t("acctRemoveTitle", { name }), text: t("acctRemoveText"), confirmLabel: t("acctRemove"), cancelLabel: t("noticeCancel"), kind: "danger" });
    if (!ok) return;
    hideNotice();
    setBusy(true); setSaid(null);
    try { await removeSteamAccount(id64); await load(); setSaid({ tone: "ok", text: t("acctRemoved", { name }) }); }
    catch (failure) { setSaid({ tone: "error", text: String(failure instanceof Error ? failure.message : failure) }); }
    finally { setBusy(false); }
  };
  const syncNow = async () => {
    setBusy(true); setSaid(null);
    try { await syncSteamLibrary([], { refresh: true }); await load(); setSaid({ tone: "ok", text: t("acctSynced") }); }
    catch (failure) { setSaid({ tone: "error", text: String(failure instanceof Error ? failure.message : failure) }); }
    finally { setBusy(false); }
  };

  const accounts = status?.accounts ?? [];
  const suggestions = status?.suggestions ?? [];
  const synced = status?.owned_fetched_at ? new Date(status.owned_fetched_at * 1000).toLocaleString(locale === "es" ? "es-AR" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return <section className="ga-account-libraries">
    <p className="ga-hint">{t("acctIntro")}</p>
    <div className="ga-settings-group ga-account-store">
      <div className="ga-account-store-head">
        <div className="ga-account-text">
          <span className="ga-label">Steam</span>
          <p className="ga-hint">{status && !status.found ? t("acctSteamMissing") : synced ? t("acctSteamSynced", { when: synced }) : t("acctSteamHint")}</p>
        </div>
        <div className="ga-account-actions">
          {accounts.length ? <GaButton disabled={busy || linking !== null || !native} icon={<RefreshCw size={16} aria-hidden="true" />} onClick={() => void syncNow()}>{t("acctSyncNow")}</GaButton> : null}
          <GaButton variant="primary" disabled={linking !== null || !native} icon={<LogIn size={16} aria-hidden="true" />} onClick={() => void link()}>{t("acctSteamLink")}</GaButton>
        </div>
      </div>
      {linking !== null ? <div className="ga-account-waiting">
        <p role="status" className="ga-status"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{linking ? t("acctWaitingFor", { name: linking }) : t("acctWaiting")}</p>
        <GaButton onClick={cancel}>{t("noticeCancel")}</GaButton>
      </div> : null}
      {said ? <p role="status" className={`ga-status is-${said.tone}`}>{said.text}</p> : null}
      {accounts.length ? <ul className="ga-account-list">
        {accounts.map(account => {
          const name = account.persona_name || account.account_name || account.steam_id64;
          return <li key={account.steam_id64} className="ga-account-row">
            <div className="ga-account-text">
              <b className="ga-account-name">{name}{account.account_name && account.account_name !== name ? <span className="ga-hint"> {account.account_name}</span> : null}</b>
              <p className="ga-hint">{[t("acctGames", { installed: account.installed_count, owned: account.owned_count }), account.active ? t("acctActive") : account.remembered ? t("acctRemembered") : t("acctNotRemembered")].join(" · ")}</p>
              {account.private ? <p className="ga-status is-warn">{t("acctPrivate")}</p> : null}
              {account.error ? <p className="ga-status is-error">{t("acctError")}</p> : null}
            </div>
            <GaButton variant="danger" disabled={busy || linking !== null || !native} icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => void remove(account.steam_id64, name)}>{t("acctRemove")}</GaButton>
          </li>;
        })}
      </ul> : <p className="ga-hint">{t("acctNone")}</p>}
      {suggestions.length ? <div className="ga-group ga-account-suggestions">
        <span className="ga-label">{t("acctSuggested")}</span>
        <ul className="ga-account-list">
          {suggestions.map(suggestion => {
            const name = suggestion.persona_name || suggestion.account_name;
            return <li key={suggestion.steam_id64} className="ga-account-row">
              <div className="ga-account-text"><b className="ga-account-name">{name}{suggestion.account_name && suggestion.account_name !== name ? <span className="ga-hint"> {suggestion.account_name}</span> : null}</b>
                <p className="ga-hint">{t("acctSuggestedHint", { account: suggestion.account_name || name })}</p></div>
              <GaButton disabled={linking !== null || !native} icon={<LogIn size={16} aria-hidden="true" />} onClick={() => void link(suggestion.account_name || name)}>{t("acctSuggestLink")}</GaButton>
            </li>;
          })}
        </ul>
      </div> : null}
    </div>
    <p className="ga-hint">{t("acctMoreStores")}</p>
  </section>;
}
