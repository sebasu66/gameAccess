import { useEffect, useState, type ReactNode } from "react";
import { HelpCircle, KeyRound, Power, PowerOff, ShieldCheck, Smartphone, Trash2, UserRound } from "lucide-react";
import KidPrograms, { KidBlocked } from "./KidPrograms";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import { confirmNotice, showNotice } from "./notice/notice";
import { requestAdmin, useAccessRole } from "./accessRole";
import GaTabs from "./GaTabs";
import ParentalControlSection from "./ParentalControlSection";
import AdminKeySection from "./AdminKeySection";
import KidGamesGrid from "./KidGamesGrid";
import { DaySchedule, LiveControls, Week } from "./KidTime";
import { applyErrorText } from "./KidWizard";
import { applyKidDraft, EMPTY_LIVE, KidApplyError, readKidLive, resetKidMode, setKidModeEnabled, useKidState, usePlus, type KidLive } from "./kidMode";

/**
 * Kids screen once kid mode is set up (vault/Modo niño.md): first of all the big switch that turns kid mode's
 * restrictor on or off (restrictor.rs; the parent mode itself does not turn it off), then one control panel with five
 * tabs: the child's games, the allowed programs (with what was blocked), time, the content filter and support & settings.
 * Only the parent mode reaches this screen (ParentModeButton.tsx).
 */
function Locked({ admin, children }: { admin: boolean; children: ReactNode }) {
  return <fieldset className="ga-kid-scope ga-stack" disabled={!admin}>{children}</fieldset>;
}

function TimeTab({ sid }: { sid: string }) {
  const { t } = useI18n();
  const { draft } = useKidState();
  const [live, setLive] = useState<KidLive>(EMPTY_LIVE);
  useEffect(() => {
    let stopped = false;
    const read = () => { void readKidLive(sid).then(next => { if (!stopped) setLive(next); }); };
    read();
    const timer = window.setInterval(read, 10_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [sid]);
  return <>
    <DaySchedule draft={draft} />
    <Week live={live} draft={draft} />
    <LiveControls sid={sid} live={live} onLive={setLive} />
  </>;
}

function SupportTab({ busy, onReset }: { busy: boolean; onReset: () => void }) {
  const { t } = useI18n();
  return <>
    <fieldset className="ga-group"><legend className="ga-label"><KeyRound size={13} aria-hidden="true" />{t("adminKeyTab")}</legend><AdminKeySection /></fieldset>
    <fieldset className="ga-group"><legend className="ga-label"><HelpCircle size={13} aria-hidden="true" />{t("kidHelpTitle")}</legend>
      <p className="ga-hint">{t("kidHelpText")}</p>
      <p className="ga-hint">{t("kidHelpContact")}</p>
    </fieldset>
    <p className="ga-kid-phone ga-hint"><Smartphone size={16} aria-hidden="true" />{t("kidPhoneSoon")}</p>
    <fieldset className="ga-group ga-group-danger"><legend className="ga-label">{t("kidResetLegend")}</legend>
      <p className="ga-hint">{t("kidResetHint")}</p>
      <div className="ga-actions"><GaButton variant="danger" icon={<Trash2 size={16} aria-hidden="true" />} disabled={busy} onClick={onReset}>{t("kidReset")}</GaButton></div>
    </fieldset>
  </>;
}

/** The big switch: kid mode on (only the allow list runs) or off (nothing is closed). Saved at once. */
function KidSwitch() {
  const { t } = useI18n();
  const { status } = useKidState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const turn = async (on: boolean) => {
    setBusy(true); setError("");
    try { await setKidModeEnabled(on); } catch (failure) { setError(t("kidApplyFailed", { error: failure instanceof KidApplyError ? failure.code : String(failure) })); } finally { setBusy(false); }
  };
  const service = status.service === "missing" ? t("kidServiceMissing") : status.service === "stopped" ? t("kidServiceStopped") : "";
  return <section className="ga-kid-power ga-stack ga-stack-sm" aria-live="polite">
    <div className="ga-kid-power-row">
      <div className="ga-stack ga-stack-sm"><h3 className="ga-heading">{status.enabled ? t("kidSwitchOn") : t("kidSwitchOff")}</h3><p className="ga-hint">{status.enabled ? t("kidSwitchOnHint") : t("kidSwitchOffHint")}</p></div>
      {status.enabled
        ? <GaButton variant="danger" icon={<PowerOff size={16} aria-hidden="true" />} disabled={busy} onClick={() => void turn(false)}>{t("kidSwitchTurnOff")}</GaButton>
        : <GaButton variant="primary" icon={<Power size={16} aria-hidden="true" />} disabled={busy} onClick={() => void turn(true)}>{t("kidSwitchTurnOn")}</GaButton>}
    </div>
    {service ? <p className="ga-status is-warn" role="note">{service}</p> : null}
    {error ? <p className="ga-status is-error" role="alert">{error}</p> : null}
  </section>;
}

export default function KidControlPanel() {
  const { t } = useI18n();
  const { draft, applied, dirty } = useKidState();
  const plus = usePlus();
  const admin = useAccessRole() === "admin";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sid = applied?.sid ?? "";
  const apply = async () => {
    setBusy(true); setError("");
    try { await applyKidDraft(); showNotice({ tone: "ok", title: t("kidApplied", { name: draft.name }) }); }
    catch (failure) { setError(applyErrorText(failure, t)); } finally { setBusy(false); }
  };
  /** Undoes everything kid mode made: the account, its profile and the family file; the screen goes back to the start. */
  const reset = async () => {
    const ok = await confirmNotice({ title: t("kidResetTitle", { name: draft.name }), text: t("kidResetText"), confirmLabel: t("kidReset"), cancelLabel: t("noticeCancel") });
    if (!ok) return;
    setBusy(true); setError("");
    try { await resetKidMode(); showNotice({ tone: "ok", title: t("kidResetDone") }); }
    catch (failure) {
      const code = failure instanceof KidApplyError ? failure.code : String(failure);
      setError(code === "cancelled" ? t("kidApplyCancelled") : t("kidResetFailed", { error: code }));
    } finally { setBusy(false); }
  };
  return <div className="ga-stack">
    <KidSwitch />
    <p className="ga-kid-summary ga-hint"><UserRound size={16} aria-hidden="true" /><strong>{draft.name}</strong>
      <span>{draft.dailyMinutes ? t("kidMinutes", { minutes: String(draft.dailyMinutes) }) : t("kidNoLimit")} · {t("kidGames", { count: String(draft.games.length) })}</span></p>
    {admin ? null : <div className="ga-kid-plus ga-status" role="note"><KeyRound size={16} aria-hidden="true" /><span>{t("kidReadOnly")}</span>
      <GaButton onClick={() => void requestAdmin()}>{t("kidUnlockEdit")}</GaButton></div>}
    {plus ? null : <p className="ga-kid-plus ga-status" role="note">{t("kidNeedsPlus")}</p>}
    <GaTabs label={t("familyTitle")} tabs={[
      { id: "games", label: t("kidTabGames"), content: <Locked admin={admin}><p className="ga-hint">{t("kidGamesHint")} {t("kidGameLimitHint")}</p><KidGamesGrid /></Locked> },
      { id: "programs", label: t("kidTabPrograms"), content: <Locked admin={admin}><KidPrograms /><fieldset className="ga-group"><legend className="ga-label">{t("kidBlockedTitle")}</legend><KidBlocked /></fieldset></Locked> },
      { id: "time", label: t("kidTabTime"), content: <Locked admin={admin}><TimeTab sid={sid} /></Locked> },
      { id: "filter", label: t("familyTabFilter"), content: <Locked admin={admin}><ParentalControlSection /></Locked> },
      { id: "support", label: t("kidTabSupport"), content: <Locked admin={admin}><SupportTab busy={busy} onReset={() => void reset()} /></Locked> },
    ]} />
    {error ? <p className="ga-status is-error" role="alert">{error}</p> : null}
    <div className="ga-kid-tab-foot">
      <p className="ga-hint">{dirty ? t("kidPending") : t("kidUpToDate")}</p>
      <GaButton variant="primary" icon={<ShieldCheck size={16} aria-hidden="true" />} disabled={!admin || busy || !dirty || !plus} aria-busy={busy} onClick={() => void apply()}>{busy ? t("kidApplying") : t("kidApply")}</GaButton>
    </div>
  </div>;
}
