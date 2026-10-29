import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Baby, BarChart3, Clock, Gamepad2, Lock, Plus, ShieldCheck, Smartphone, Sparkles, Square, Trash2, Unlock, UserRound } from "lucide-react";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import { GaButton, GaClose, GaIconButton } from "./components/ga/Buttons";
import { confirmNotice, showNotice } from "./notice/notice";
import { OPEN_PREMIUM_EVENT } from "./PremiumEntry";
import {
  applyKidDraft, EMPTY_LIVE, KidApplyError, loadKidFamily, readKidLive, resetKidMode, sendKidControl, setKidDraft, setKidGameMinutes, useKidState, usePlus, validKidName,
  type Kid, type KidControlAction, type KidLive,
} from "./kidMode";
import "./kid-mode.css";

/**
 * The adult's kid mode (kidMode.ts). Without a child account yet it is a small wizard: what the feature is (a page that
 * sells it, locked behind PLUS), the child's account, then time and hours. Once the account exists the same dialog is the
 * child's panel: the week's play, live orders (stop, close the day, add minutes), the games and the settings.
 * "Apply" asks Windows for permission once and sets everything up.
 */
const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const LIMITS = [0, 30, 60, 90, 120, 180, 240];
const GAME_LIMITS = [0, 15, 30, 45, 60, 90, 120];
const range = (value: string): [number, number] => { const [from, to] = value.split("-").map(Number); return [Number.isFinite(from) ? from : 0, Number.isFinite(to) ? to : 24]; };

type Step = "intro" | "account" | "schedule";

function Hours({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const [from, to] = range(value);
  const pick = (next: [number, number]) => onChange(`${next[0]}-${next[1]}`);
  return <div className="ga-kid-hours"><span>{label}</span>
    <label>{t("kidFrom")}<select value={from} onChange={event => { const start = Number(event.target.value); pick([start, Math.max(to, start + 1)]); }}>{HOURS.slice(0, 24).map(hour => <option key={hour} value={hour}>{`${hour}:00`}</option>)}</select></label>
    <label>{t("kidTo")}<select value={to} onChange={event => { const end = Number(event.target.value); pick([Math.min(from, end - 1), end]); }}>{HOURS.slice(1).map(hour => <option key={hour} value={hour}>{`${hour}:00`}</option>)}</select></label>
  </div>;
}

/** Daily time and the allowed hours: the wizard's second step and the panel's settings. */
function TimeFields({ draft }: { draft: Kid }) {
  const { t } = useI18n();
  return <>
    <fieldset><legend>{t("kidDailyTime")}</legend>
      <select className="ga-kid-limit" value={draft.dailyMinutes} onChange={event => setKidDraft({ dailyMinutes: Number(event.target.value) })}>
        {LIMITS.map(minutes => <option key={minutes} value={minutes}>{minutes ? t("kidMinutes", { minutes: String(minutes) }) : t("kidNoLimit")}</option>)}
      </select>
    </fieldset>
    <fieldset><legend>{t("kidSchedule")}</legend>
      <Hours label={t("kidWeekdays")} value={draft.weekdays} onChange={weekdays => setKidDraft({ weekdays })} />
      <Hours label={t("kidWeekend")} value={draft.weekend} onChange={weekend => setKidDraft({ weekend })} />
      <p className="ga-kid-hint">{t("kidScheduleHint")}</p>
    </fieldset>
  </>;
}

function Intro({ plus, onStart, onPlus }: { plus: boolean; onStart: () => void; onPlus: () => void }) {
  const { t } = useI18n();
  const benefits = [
    { icon: <UserRound size={22} aria-hidden="true" />, title: t("kidIntroB1Title"), text: t("kidIntroB1Text") },
    { icon: <Gamepad2 size={22} aria-hidden="true" />, title: t("kidIntroB2Title"), text: t("kidIntroB2Text") },
    { icon: <Clock size={22} aria-hidden="true" />, title: t("kidIntroB3Title"), text: t("kidIntroB3Text") },
    { icon: <Smartphone size={22} aria-hidden="true" />, title: t("kidIntroB4Title"), text: t("kidIntroB4Text") },
  ];
  return <div className="ga-kid-intro">
    <p className="ga-kid-lead">{t("kidIntroLead")}</p>
    <ul className="ga-kid-benefits">{benefits.map(item => <li key={item.title}><span className="ga-kid-benefit-icon">{item.icon}</span><div><strong>{item.title}</strong><p>{item.text}</p></div></li>)}</ul>
    <p className="ga-kid-hint">{t("kidIntroSteps")}</p>
    <div className="ga-kid-cta">
      <GaButton variant="primary" icon={plus ? <ArrowRight size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />} aria-disabled={!plus} onClick={() => { if (plus) onStart(); }}>{plus ? t("kidIntroStart") : t("kidIntroLocked")}</GaButton>
      {plus ? null : <GaButton icon={<Sparkles size={16} aria-hidden="true" />} onClick={onPlus}>{t("kidIntroKnowPlus")}</GaButton>}
    </div>
  </div>;
}

const formatDuration = (seconds: number, t: ReturnType<typeof useI18n>["t"]) => {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? t("kidDurationHM", { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) }) : t("kidDurationM", { minutes: String(minutes) });
};

/** The week's play: a bar per day (against the daily limit) and what was played the most. */
function Week({ live, draft }: { live: KidLive; draft: Kid }) {
  const { t, locale } = useI18n();
  const limit = draft.dailyMinutes * 60;
  const scale = Math.max(limit, ...live.days.map(day => day.seconds), 1);
  const names = new Map(draft.games.map(game => [String(game.appId), game.name]));
  const totals = new Map<string, number>();
  for (const day of live.days) for (const [id, seconds] of Object.entries(day.games)) totals.set(id, (totals.get(id) ?? 0) + seconds);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return <fieldset><legend><BarChart3 size={13} aria-hidden="true" /> {t("kidWeek")}</legend>
    {live.days.some(day => day.seconds > 0) ? <>
      <ul className="ga-kid-week">{live.days.map(day => {
        const detail = Object.entries(day.games).map(([id, seconds]) => `${names.get(id) ?? id}: ${formatDuration(seconds, t)}`).join(" · ");
        return <li key={day.date} title={detail}>
          <span>{new Date(`${day.date}T12:00:00`).toLocaleDateString(locale, { weekday: "short" })}</span>
          <span className="ga-kid-bar"><i style={{ width: `${Math.round((day.seconds / scale) * 100)}%` }} /></span>
          <b>{day.seconds ? formatDuration(day.seconds, t) : "—"}</b></li>;
      })}</ul>
      {top.length ? <p className="ga-kid-hint">{t("kidMostPlayed")} {top.map(([id, seconds]) => `${names.get(id) ?? id} (${formatDuration(seconds, t)})`).join(" · ")}</p> : null}
    </> : <p className="ga-kid-hint">{t("kidWeekEmpty")}</p>}
  </fieldset>;
}

/** Live orders: take effect in seconds, without applying anything to Windows. */
function LiveControls({ sid, live, onLive }: { sid: string; live: KidLive; onLive: (live: KidLive) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const send = async (action: KidControlAction, minutes = 0, done = "") => {
    setBusy(true);
    try { onLive(await sendKidControl(sid, action, minutes)); if (done) showNotice({ tone: "ok", title: done }); }
    catch (failure) { showNotice({ tone: "error", title: failure instanceof KidApplyError && failure.code === "needs_apply" ? t("kidLiveNeedsApply") : t("kidLiveFailed") }); }
    finally { setBusy(false); }
  };
  const off = busy || !sid;
  return <fieldset><legend>{t("kidLive")}</legend>
    <div className="ga-kid-live">
      <GaButton icon={<Square size={16} aria-hidden="true" />} disabled={off} onClick={() => void send("stop", 0, t("kidLiveStopped"))}>{t("kidStopNow")}</GaButton>
      <GaButton icon={live.lockedToday ? <Unlock size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />} disabled={off}
        onClick={() => void send(live.lockedToday ? "unlock" : "lock", 0, live.lockedToday ? t("kidLiveUnlocked") : t("kidLiveLocked"))}>{live.lockedToday ? t("kidUnlockToday") : t("kidLockToday")}</GaButton>
      {[15, 30].map(minutes => <GaButton key={minutes} icon={<Plus size={16} aria-hidden="true" />} disabled={off} onClick={() => void send("extend", minutes, t("kidLiveExtended", { minutes: String(minutes) }))}>{t("kidAddMinutes", { minutes: String(minutes) })}</GaButton>)}
    </div>
    <p className="ga-kid-hint">{live.extraMinutes ? `${t("kidExtraToday", { minutes: String(live.extraMinutes) })} ` : ""}{live.lockedToday ? `${t("kidLockedToday")} ` : ""}{live.channel ? "" : t("kidLiveNeedsApply")}</p>
  </fieldset>;
}

function Dashboard({ draft, sid, busy, onReset }: { draft: Kid; sid: string; busy: boolean; onReset: () => void }) {
  const { t } = useI18n();
  const [live, setLive] = useState<KidLive>(EMPTY_LIVE);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    let stopped = false;
    const read = () => { void readKidLive(sid).then(next => { if (!stopped) setLive(next); }); };
    read();
    const timer = window.setInterval(read, 10_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [sid]);
  return <>
    <label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={draft.enabled} onChange={event => setKidDraft({ enabled: event.target.checked })} />{t("kidModeOn")}</label>
    <p className="ga-kid-summary"><UserRound size={16} aria-hidden="true" /><strong>{draft.name}</strong>
      <span>{draft.dailyMinutes ? t("kidMinutes", { minutes: String(draft.dailyMinutes) }) : t("kidNoLimit")} · {t("kidWeekdays")} {draft.weekdays.replace("-", "–")} · {t("kidWeekend")} {draft.weekend.replace("-", "–")}</span></p>
    <Week live={live} draft={draft} />
    <LiveControls sid={sid} live={live} onLive={setLive} />
    <fieldset><legend>{t("kidGames", { count: String(draft.games.length) })}</legend>
      {draft.games.length ? <ul className="ga-kid-chosen">{draft.games.map(game => <li key={game.appId}><span>{game.name}</span>
        <select aria-label={t("kidGameLimitAria", { name: game.name })} value={game.dailyMinutes ?? 0} onChange={event => setKidGameMinutes(game.appId, Number(event.target.value))}>
          {GAME_LIMITS.map(minutes => <option key={minutes} value={minutes}>{minutes ? t("kidGameMax", { minutes: String(minutes) }) : t("kidGameDailyOnly")}</option>)}
        </select></li>)}</ul> : null}
      <p className="ga-kid-hint">{t("kidGamesHint")} {t("kidGameLimitHint")}</p>
    </fieldset>
    <div><GaButton onClick={() => setSettings(open => !open)} aria-expanded={settings}>{t("kidChangeTime")}</GaButton></div>
    {settings ? <TimeFields draft={draft} /> : null}
    <p className="ga-kid-phone"><Smartphone size={16} aria-hidden="true" />{t("kidPhoneSoon")}</p>
    <fieldset className="ga-kid-danger"><legend>{t("kidResetLegend")}</legend>
      <p className="ga-kid-hint">{t("kidResetHint")}</p>
      <div><GaButton variant="danger" icon={<Trash2 size={16} aria-hidden="true" />} disabled={busy} onClick={onReset}>{t("kidReset")}</GaButton></div>
    </fieldset>
  </>;
}

function KidModeDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const panel = useDialogFocus(onClose);
  const { draft, applied, dirty } = useKidState();
  const [step, setStep] = useState<Step>("intro");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const made = applied !== null;
  const plus = usePlus();
  const apply = async () => {
    if (!validKidName(draft.name)) { setError(t("kidBadName")); return; }
    setBusy(true); setError("");
    try {
      await applyKidDraft();
      showNotice({ tone: "ok", title: t("kidApplied", { name: draft.name }) });
    } catch (failure) {
      const code = failure instanceof KidApplyError ? failure.code : String(failure);
      setError(code === "cancelled" ? t("kidApplyCancelled") : code === "needs_plus" ? t("kidNeedsPlus") : code === "not_program_files" ? t("kidNotProgramFiles") : code === "bad_name" ? t("kidBadName") : t("kidApplyFailed", { error: code }));
    } finally { setBusy(false); }
  };
  /** Undoes everything kid mode made: the account, its profile and the family file; the screen starts from zero. */
  const reset = async () => {
    const ok = await confirmNotice({ title: t("kidResetTitle", { name: draft.name }), text: t("kidResetText"), confirmLabel: t("kidReset"), cancelLabel: t("noticeCancel") });
    if (!ok) return;
    setBusy(true); setError("");
    try {
      await resetKidMode();
      setStep("intro");
      showNotice({ tone: "ok", title: t("kidResetDone") });
    } catch (failure) {
      const code = failure instanceof KidApplyError ? failure.code : String(failure);
      setError(code === "cancelled" ? t("kidApplyCancelled") : t("kidResetFailed", { error: code }));
    } finally { setBusy(false); }
  };
  const knowPlus = () => { onClose(); window.dispatchEvent(new Event(OPEN_PREMIUM_EVENT)); };
  const wizard = made ? null : step;
  const title = wizard === "account" ? t("kidStep1Title") : wizard === "schedule" ? t("kidStep2Title") : wizard === "intro" ? t("kidIntroTitle") : t("kidModeTitle");
  const subtitle = wizard === "account" ? t("kidStepOf", { step: "1" }) : wizard === "schedule" ? t("kidStepOf", { step: "2" }) : wizard === "intro" ? t("kidIntroEyebrow") : t("kidModeSubtitle");
  return <div className="ga-settings-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={panel} className="ga-settings-panel ga-kid-panel" role="dialog" aria-modal="true" aria-labelledby="ga-kid-title">
      <header><div><span className="eyebrow">GAME ACCESS</span><h2 id="ga-kid-title">{title}</h2><p>{subtitle}</p></div><GaClose label={t("close")} onClick={onClose} data-dialog-initial /></header>
      <div className="ga-kid-panel-body">
        {plus || wizard === "intro" ? null : <p className="ga-kid-plus" role="note"><Sparkles size={16} aria-hidden="true" />{t("kidNeedsPlus")}</p>}
        {wizard === "intro" ? <Intro plus={plus} onStart={() => setStep("account")} onPlus={knowPlus} /> : null}
        {wizard === "account" ? <>
          <p className="ga-kid-lead">{t("kidStep1Text")}</p>
          <label className="ga-field"><span>{t("kidStep1Label")}</span>
            <input value={draft.name} maxLength={20} placeholder={t("kidAccountPlaceholder")} autoFocus onChange={event => setKidDraft({ name: event.target.value.trim() })} /></label>
          <p className="ga-kid-hint">{t("kidAccountNoPassword")}</p>
        </> : null}
        {wizard === "schedule" ? <><p className="ga-kid-lead">{t("kidStep2Text")}</p><TimeFields draft={draft} /></> : null}
        {made ? <Dashboard draft={draft} sid={applied?.sid ?? ""} busy={busy} onReset={() => void reset()} /> : null}
        {error ? <p className="ga-parental-error" role="alert">{error}</p> : null}
      </div>
      {wizard === "intro" ? null : <footer>
        {made ? <p>{dirty ? t("kidPending") : t("kidUpToDate")}</p> : <GaButton icon={<ArrowLeft size={16} aria-hidden="true" />} disabled={busy} onClick={() => setStep(wizard === "schedule" ? "account" : "intro")}>{t("kidBack")}</GaButton>}
        <div>
          {wizard === "account" ? <GaButton variant="primary" icon={<ArrowRight size={16} aria-hidden="true" />} disabled={!validKidName(draft.name)} onClick={() => setStep("schedule")}>{t("kidNext")}</GaButton> : null}
          {wizard === "schedule" ? <GaButton variant="primary" icon={<ShieldCheck size={16} aria-hidden="true" />} disabled={busy || !plus} aria-busy={busy} onClick={() => void apply()}>{busy ? t("kidApplying") : t("kidCreate")}</GaButton> : null}
          {made ? <GaButton variant="primary" icon={<ShieldCheck size={16} aria-hidden="true" />} disabled={busy || !dirty || !plus} aria-busy={busy} onClick={() => void apply()}>{busy ? t("kidApplying") : t("kidApply")}</GaButton> : null}
        </div></footer>}
    </section>
  </div>;
}

export default function KidModePanel({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { void loadKidFamily(); }, []);
  const close = useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }, []);
  const button = <GaIconButton ref={trigger} className="ga-kid-fab" icon={<Baby size={20} aria-hidden="true" />} label={t("kidModeTitle")} onClick={() => setOpen(true)} />;
  return <>
    {dockTarget ? createPortal(button, dockTarget) : button}
    {open ? <KidModeDialog onClose={close} /> : null}
  </>;
}
