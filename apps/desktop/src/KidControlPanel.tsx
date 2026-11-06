import { useEffect, useState } from "react";
import { HelpCircle, KeyRound, ShieldCheck, Smartphone, Trash2, UserRound } from "lucide-react";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import { confirmNotice, showNotice } from "./notice/notice";
import GaTabs from "./GaTabs";
import ParentalControlSection from "./ParentalControlSection";
import AdminKeySection from "./AdminKeySection";
import KidGamesGrid from "./KidGamesGrid";
import { DaySchedule, Week } from "./KidTime";
import { applyErrorText } from "./KidWizard";
import { applyKidDraft, EMPTY_LIVE, KidApplyError, readKidLive, resetKidMode, setKidDraft, useKidState, usePlus, type KidLive } from "./kidMode";

/**
 * Kids screen once kid mode is on (vault/Modo niño.md): one control panel with four tabs, the child's games, time,
 * the content filter and support & settings. Only the parent reaches it: opening it asks for the parent's key
 * (KidModePanel.tsx, ParentKeyDialog.tsx).
 */

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
    <label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={draft.enabled} onChange={event => setKidDraft({ enabled: event.target.checked })} />{t("kidModeOn")}</label>
    <DaySchedule draft={draft} />
    <Week live={live} draft={draft} />
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

export default function KidControlPanel() {
  const { t } = useI18n();
  const { draft, applied, dirty } = useKidState();
  const plus = usePlus();
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
    <p className="ga-kid-summary ga-hint"><UserRound size={16} aria-hidden="true" /><strong>{draft.name}</strong>
      <span>{draft.dailyMinutes ? t("kidMinutes", { minutes: String(draft.dailyMinutes) }) : t("kidNoLimit")} · {t("kidGames", { count: String(draft.games.length) })}</span></p>
    {plus ? null : <p className="ga-kid-plus ga-status" role="note">{t("kidNeedsPlus")}</p>}
    <GaTabs label={t("familyTitle")} tabs={[
      { id: "games", label: t("kidTabGames"), content: <div className="ga-stack"><p className="ga-hint">{t("kidGamesHint")} {t("kidGameLimitHint")}</p><KidGamesGrid /></div> },
      { id: "time", label: t("kidTabTime"), content: <div className="ga-stack"><TimeTab sid={sid} /></div> },
      { id: "filter", label: t("familyTabFilter"), content: <div className="ga-stack"><ParentalControlSection /></div> },
      { id: "support", label: t("kidTabSupport"), content: <div className="ga-stack"><SupportTab busy={busy} onReset={() => void reset()} /></div> },
    ]} />
    {error ? <p className="ga-status is-error" role="alert">{error}</p> : null}
    <div className="ga-kid-tab-foot">
      <p className="ga-hint">{dirty ? t("kidPending") : t("kidUpToDate")}</p>
      <GaButton variant="primary" icon={<ShieldCheck size={16} aria-hidden="true" />} disabled={busy || !dirty || !plus} aria-busy={busy} onClick={() => void apply()}>{busy ? t("kidApplying") : t("kidApply")}</GaButton>
    </div>
  </div>;
}
