import { useEffect, useState } from "react";
import { GaButton } from "./components/ga/Buttons";
import { Checkbox } from "./components/ui/checkbox";
import { useI18n } from "./i18n";
import { saveSteamSettings, steamStatus, type SteamSettings as Settings, type SteamStatus } from "./steamLibrary";
import { openSection } from "./gameArea";
import { selectNavigationSection, selectNavigationTab } from "./navigation/navigationSelection";
import { guideChosen, guideState, restartSteamForGuide, setGuideForGameAccess } from "./steamGuide";

/** Settings › Steam: the Steam client Game Access found and how it is used. The accounts, whose libraries Game Access
 *  shows whole, are in Library › Manager › Accounts (AccountLibraries.tsx). */
export default function SteamSettings() {
  const { t } = useI18n();
  const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [status, setStatus] = useState<SteamStatus | null>(null);
  const [error, setError] = useState("");
  const load = () => steamStatus().then(setStatus).catch(failure => setError(String(failure)));
  useEffect(() => { if (native) void load(); }, [native]);

  const save = async (values: Partial<Settings>) => {
    setError("");
    try {
      const settings = await saveSteamSettings(values);
      setStatus(current => current ? { ...current, settings } : current);
      return true;
    } catch (failure) { setError(String(failure instanceof Error ? failure.message : failure)); return false; }
  };
  const openAccounts = () => { selectNavigationSection("library", "manager"); selectNavigationTab("library", "manager", "accounts"); openSection("manager"); };

  // The controller's Xbox button: Game Access's big picture instead of Steam's (steamGuide.ts, steam_guide.rs).
  const [guide, setGuide] = useState(guideChosen);
  const [guideNote, setGuideNote] = useState("");
  const changeGuide = async (on: boolean) => {
    setGuide(on); setError(""); setGuideNote("");
    try {
      const outcome = await setGuideForGameAccess(on);
      setGuideNote(outcome === "steam_running" ? t(on ? "steamGuideCloseSteam" : "steamGuideCloseSteamBack") : on ? t("steamGuideDone") : "");
    } catch (failure) { setError(String(failure instanceof Error ? failure.message : failure)); }
  };
  // On by default, so the pending step has to show without the player touching the option.
  useEffect(() => { if (guide && native) void guideState().then(state => { if (state.found && state.focus_pending && state.steam_running) setGuideNote(t("steamGuideCloseSteam")); }).catch(() => undefined); }, []);
  const [restarting, setRestarting] = useState(false);
  const restartSteam = async () => {
    setRestarting(true); setError(""); setGuideNote("");
    try { await restartSteamForGuide(); setGuideNote(t("steamGuideDone")); }
    catch (failure) { const said = String(failure); setGuideNote(said === "game_running" ? t("steamGuideGameRunning") : said === "steam_slow" ? t("steamGuideSlow") : said); }
    finally { setRestarting(false); }
  };
  const toggle = (id: string, label: string, hint: string, checked: boolean, name: "switch_accounts") => (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-4">
      <Checkbox id={id} tabIndex={-1} className="mt-0.5" disabled={!status?.found} checked={checked} onCheckedChange={value => void save({ [name]: value === true })} />
      <div className="grid gap-1"><label htmlFor={id} className="text-sm font-semibold">{label}</label><p className="m-0 text-sm text-muted-foreground">{hint}</p></div>
    </div>
  );

  if (!native) return <section className="grid gap-5"><h3 className="m-0 text-base font-bold">{t("steamTitle")}</h3><p className="m-0 text-sm text-muted-foreground">{t("steamDesktopOnly")}</p></section>;
  const settings = status?.settings;
  return (
    <section className="ga-steam-settings grid gap-5">
      <h3 className="m-0 text-base font-bold">{t("steamTitle")}</h3>
      {!status ? <p className="m-0 text-sm text-muted-foreground">{error || t("steamLoading")}</p> : !status.found ? <p className="m-0 text-sm text-muted-foreground">{t("steamNotFound")}</p> : <>
        <p className="m-0 text-sm text-muted-foreground">{t("steamFound", { path: status.path, games: status.installed_count, libraries: status.libraries.length })}</p>
        {toggle("ga-steam-switch", t("steamSwitch"), t("steamSwitchHint"), settings?.switch_accounts ?? true, "switch_accounts")}
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-4">
          <Checkbox id="ga-steam-guide" tabIndex={-1} className="mt-0.5" checked={guide} onCheckedChange={value => void changeGuide(value === true)} />
          <div className="grid gap-1"><label htmlFor="ga-steam-guide" className="text-sm font-semibold">{t("steamGuide")}</label><p className="m-0 text-sm text-muted-foreground">{t("steamGuideHint")}</p>
            {guideNote ? <p role="status" className="m-0 text-sm">{guideNote}</p> : null}
            {guide && guideNote && guideNote !== t("steamGuideDone") ? <div><GaButton variant="primary" disabled={restarting} onClick={() => void restartSteam()}>{t(restarting ? "steamGuideRestarting" : "steamGuideRestart")}</GaButton></div> : null}</div>
        </div>
        <div className="grid gap-2"><p className="m-0 text-sm text-muted-foreground">{t("steamAccountsMoved", { count: status.accounts.length })}</p>
          <div><GaButton variant="primary" onClick={openAccounts}>{t("steamOpenAccounts")}</GaButton></div></div>
      </>}
      {error && status ? <p className="ga-settings-error m-0 text-sm" role="alert">{error}</p> : null}
    </section>
  );
}
