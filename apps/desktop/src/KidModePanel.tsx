import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Baby, ShieldCheck, Sparkles } from "lucide-react";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import { GaButton, GaClose, GaIconButton } from "./components/ga/Buttons";
import { showNotice } from "./notice/notice";
import { applyKidDraft, KidApplyError, loadKidFamily, setKidDraft, useKidState, usePlus, validKidName } from "./kidMode";
import "./kid-mode.css";

/**
 * The adult's kid mode screen (kidMode.ts): turn it on, the child's Windows account (made without a password), the
 * hours it may sign in and the daily time. The games are chosen in the library manager. "Apply" asks Windows for
 * permission once and sets everything up.
 */
const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const LIMITS = [0, 30, 60, 90, 120, 180, 240];
const range = (value: string): [number, number] => { const [from, to] = value.split("-").map(Number); return [Number.isFinite(from) ? from : 0, Number.isFinite(to) ? to : 24]; };

function Hours({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const [from, to] = range(value);
  const pick = (next: [number, number]) => onChange(`${next[0]}-${next[1]}`);
  return <div className="ga-kid-hours"><span>{label}</span>
    <label>{t("kidFrom")}<select value={from} onChange={event => { const start = Number(event.target.value); pick([start, Math.max(to, start + 1)]); }}>{HOURS.slice(0, 24).map(hour => <option key={hour} value={hour}>{`${hour}:00`}</option>)}</select></label>
    <label>{t("kidTo")}<select value={to} onChange={event => { const end = Number(event.target.value); pick([Math.min(from, end - 1), end]); }}>{HOURS.slice(1).map(hour => <option key={hour} value={hour}>{`${hour}:00`}</option>)}</select></label>
  </div>;
}

function KidModeDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const panel = useDialogFocus(onClose);
  const { draft, applied, dirty } = useKidState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const named = Boolean(applied?.sid);
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
  return <div className="ga-settings-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={panel} className="ga-settings-panel ga-kid-panel" role="dialog" aria-modal="true" aria-labelledby="ga-kid-title">
      <header><div><span className="eyebrow">GAME ACCESS</span><h2 id="ga-kid-title">{t("kidModeTitle")}</h2><p>{t("kidModeSubtitle")}</p></div><GaClose label={t("close")} onClick={onClose} data-dialog-initial /></header>
      <div className="ga-kid-panel-body">
        {plus ? null : <p className="ga-kid-plus" role="note"><Sparkles size={16} aria-hidden="true" />{t("kidNeedsPlus")}</p>}
        <label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={draft.enabled} onChange={event => setKidDraft({ enabled: event.target.checked })} />{t("kidModeOn")}</label>
        <fieldset><legend>{t("kidAccount")}</legend>
          <label className="ga-field"><span>{t("kidAccountName")}</span>
            <input value={draft.name} maxLength={20} disabled={named} placeholder={t("kidAccountPlaceholder")} onChange={event => setKidDraft({ name: event.target.value.trim() })} /></label>
          <p className="ga-kid-hint">{named ? t("kidAccountMade") : t("kidAccountNoPassword")}</p>
        </fieldset>
        <fieldset><legend>{t("kidSchedule")}</legend>
          <Hours label={t("kidWeekdays")} value={draft.weekdays} onChange={weekdays => setKidDraft({ weekdays })} />
          <Hours label={t("kidWeekend")} value={draft.weekend} onChange={weekend => setKidDraft({ weekend })} />
          <p className="ga-kid-hint">{t("kidScheduleHint")}</p>
        </fieldset>
        <fieldset><legend>{t("kidDailyTime")}</legend>
          <select className="ga-kid-limit" value={draft.dailyMinutes} onChange={event => setKidDraft({ dailyMinutes: Number(event.target.value) })}>
            {LIMITS.map(minutes => <option key={minutes} value={minutes}>{minutes ? t("kidMinutes", { minutes: String(minutes) }) : t("kidNoLimit")}</option>)}
          </select>
        </fieldset>
        <fieldset><legend>{t("kidGames", { count: String(draft.games.length) })}</legend>
          {draft.games.length ? <ul className="ga-kid-chosen">{draft.games.map(game => <li key={game.appId}>{game.name}</li>)}</ul> : null}
          <p className="ga-kid-hint">{t("kidGamesHint")}</p>
        </fieldset>
        {error ? <p className="ga-parental-error" role="alert">{error}</p> : null}
      </div>
      <footer><p>{dirty ? t("kidPending") : applied ? t("kidUpToDate") : t("kidNotYet")}</p>
        <div><GaButton variant="primary" icon={<ShieldCheck size={16} aria-hidden="true" />} disabled={busy || !draft.name || !plus} aria-busy={busy} onClick={() => void apply()}>{busy ? t("kidApplying") : t("kidApply")}</GaButton></div></footer>
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
