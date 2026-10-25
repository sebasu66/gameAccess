import { useEffect, useState } from "react";
import { GaButton } from "./components/ga/Buttons";
import { Checkbox } from "./components/ui/checkbox";
import { useI18n } from "./i18n";
import { saveSteamSettings, steamStatus, syncSteamLibrary, type SteamSettings as Settings, type SteamStatus } from "./steamLibrary";
import { useLibraryGames } from "./libraryMembership";

/** Settings › Steam: the Steam client Game Access found, its remembered accounts and how the Steam library is used. */
export default function SteamSettings() {
  const { t } = useI18n();
  const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [status, setStatus] = useState<SteamStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const members = useLibraryGames();
  const load = () => steamStatus().then(setStatus).catch(failure => setError(String(failure)));
  useEffect(() => { if (native) void load(); }, [native]);

  const save = async (values: Partial<Settings>) => {
    setError(""); setMessage("");
    try {
      const settings = await saveSteamSettings(values);
      setStatus(current => current ? { ...current, settings } : current);
      return true;
    } catch (failure) { setError(String(failure instanceof Error ? failure.message : failure)); return false; }
  };
  const importNow = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await syncSteamLibrary(members, { refresh: true });
      setMessage(t("steamImported", { linked: result.linked.length, owned: result.owned.length }));
      await load();
    } catch (failure) { setError(String(failure instanceof Error ? failure.message : failure)); } finally { setBusy(false); }
  };

  const toggle = (id: string, label: string, hint: string, checked: boolean, name: "auto_import" | "switch_accounts") => (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-4">
      <Checkbox id={id} tabIndex={-1} className="mt-0.5" disabled={!status?.found} checked={checked} onCheckedChange={value => void save({ [name]: value === true })} />
      <div className="grid gap-1"><label htmlFor={id} className="text-sm font-semibold">{label}</label><p className="m-0 text-sm text-muted-foreground">{hint}</p></div>
    </div>
  );

  if (!native) return <section className="grid gap-5"><h3 className="m-0 text-base font-bold">{t("steamTitle")}</h3><p className="m-0 text-sm text-muted-foreground">{t("steamDesktopOnly")}</p></section>;
  const settings = status?.settings;
  const accounts = [...(status?.accounts ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || (b.installed_count + b.owned_count) - (a.installed_count + a.owned_count));
  return (
    <section className="ga-steam-settings grid gap-5">
      <h3 className="m-0 text-base font-bold">{t("steamTitle")}</h3>
      {!status ? <p className="m-0 text-sm text-muted-foreground">{error || t("steamLoading")}</p> : !status.found ? <p className="m-0 text-sm text-muted-foreground">{t("steamNotFound")}</p> : <>
        <p className="m-0 text-sm text-muted-foreground">{t("steamFound", { path: status.path, games: status.installed_count, libraries: status.libraries.length })}</p>
        {toggle("ga-steam-auto", t("steamAutoImport"), t("steamAutoImportHint"), settings?.auto_import ?? true, "auto_import")}
        {toggle("ga-steam-switch", t("steamSwitch"), t("steamSwitchHint"), settings?.switch_accounts ?? true, "switch_accounts")}
        <div><GaButton variant="primary" disabled={busy} onClick={() => void importNow()}>{busy ? t("steamImporting") : t("steamImportNow")}</GaButton></div>
        <details className="ga-settings-group rounded-lg border border-border bg-card/50 p-4">
          <summary className="cursor-pointer text-sm font-bold">{t("steamAccounts", { count: accounts.length })}</summary>
          <ul className="ga-steam-accounts mt-3 grid gap-1 p-0">
            {accounts.map(account => (
              <li key={account.steam_id64} className="flex items-center justify-between gap-4 text-sm">
                <span className="min-w-0 truncate"><b>{account.persona_name}</b> <span className="text-muted-foreground">{account.account_name}</span></span>
                <span className="shrink-0 text-muted-foreground">
                  {[account.active ? t("steamAccountActive") : "", account.private ? t("steamAccountPrivate") : "",
                    t("steamAccountGames", { installed: account.installed_count, owned: account.owned_count })].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </>}
      {message ? <p role="status" className="m-0 text-sm text-success">{message}</p> : null}
      {error && status ? <p className="ga-settings-error m-0 text-sm" role="alert">{error}</p> : null}
    </section>
  );
}
