import { useState } from "react";
import { BarChart3, Lock, Plus, Square, Unlock } from "lucide-react";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import { showNotice } from "./notice/notice";
import { KidApplyError, sendKidControl, setKidDraft, type Kid, type KidControlAction, type KidLive } from "./kidMode";

/** The kids panel's Time tab (vault/Modo niño.md): daily time and allowed hours, the week's play and live orders. */
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

/** Daily time and the allowed hours. */
export function TimeFields({ draft }: { draft: Kid }) {
  const { t } = useI18n();
  return <>
    <fieldset className="ga-group"><legend className="ga-label">{t("kidDailyTime")}</legend>
      <select className="ga-kid-limit" value={draft.dailyMinutes} onChange={event => setKidDraft({ dailyMinutes: Number(event.target.value) })}>
        {LIMITS.map(minutes => <option key={minutes} value={minutes}>{minutes ? t("kidMinutes", { minutes: String(minutes) }) : t("kidNoLimit")}</option>)}
      </select>
    </fieldset>
    <fieldset className="ga-group"><legend className="ga-label">{t("kidSchedule")}</legend>
      <Hours label={t("kidWeekdays")} value={draft.weekdays} onChange={weekdays => setKidDraft({ weekdays })} />
      <Hours label={t("kidWeekend")} value={draft.weekend} onChange={weekend => setKidDraft({ weekend })} />
      <p className="ga-hint">{t("kidScheduleHint")}</p>
    </fieldset>
  </>;
}

const formatDuration = (seconds: number, t: ReturnType<typeof useI18n>["t"]) => {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? t("kidDurationHM", { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) }) : t("kidDurationM", { minutes: String(minutes) });
};

/** The week's play: a bar per day (against the daily limit) and what was played the most. */
export function Week({ live, draft }: { live: KidLive; draft: Kid }) {
  const { t, locale } = useI18n();
  const limit = draft.dailyMinutes * 60;
  const scale = Math.max(limit, ...live.days.map(day => day.seconds), 1);
  const names = new Map(draft.games.map(game => [String(game.appId), game.name]));
  const totals = new Map<string, number>();
  for (const day of live.days) for (const [id, seconds] of Object.entries(day.games)) totals.set(id, (totals.get(id) ?? 0) + seconds);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return <fieldset className="ga-group"><legend className="ga-label"><BarChart3 size={13} aria-hidden="true" />{t("kidWeek")}</legend>
    {live.days.some(day => day.seconds > 0) ? <>
      <ul className="ga-kid-week">{live.days.map(day => {
        const detail = Object.entries(day.games).map(([id, seconds]) => `${names.get(id) ?? id}: ${formatDuration(seconds, t)}`).join(" · ");
        return <li key={day.date} title={detail}>
          <span>{new Date(`${day.date}T12:00:00`).toLocaleDateString(locale, { weekday: "short" })}</span>
          <span className="ga-kid-bar"><i style={{ width: `${Math.round((day.seconds / scale) * 100)}%` }} /></span>
          <b>{day.seconds ? formatDuration(day.seconds, t) : "—"}</b></li>;
      })}</ul>
      {top.length ? <p className="ga-hint">{t("kidMostPlayed")} {top.map(([id, seconds]) => `${names.get(id) ?? id} (${formatDuration(seconds, t)})`).join(" · ")}</p> : null}
    </> : <p className="ga-hint">{t("kidWeekEmpty")}</p>}
  </fieldset>;
}

/** Live orders: take effect in seconds, without applying anything to Windows. */
export function LiveControls({ sid, live, onLive }: { sid: string; live: KidLive; onLive: (live: KidLive) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const send = async (action: KidControlAction, minutes = 0, done = "") => {
    setBusy(true);
    try { onLive(await sendKidControl(sid, action, minutes)); if (done) showNotice({ tone: "ok", title: done }); }
    catch (failure) { showNotice({ tone: "error", title: failure instanceof KidApplyError && failure.code === "needs_apply" ? t("kidLiveNeedsApply") : t("kidLiveFailed") }); }
    finally { setBusy(false); }
  };
  const off = busy || !sid;
  return <fieldset className="ga-group"><legend className="ga-label">{t("kidLive")}</legend>
    <div className="ga-actions">
      <GaButton icon={<Square size={16} aria-hidden="true" />} disabled={off} onClick={() => void send("stop", 0, t("kidLiveStopped"))}>{t("kidStopNow")}</GaButton>
      <GaButton icon={live.lockedToday ? <Unlock size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />} disabled={off}
        onClick={() => void send(live.lockedToday ? "unlock" : "lock", 0, live.lockedToday ? t("kidLiveUnlocked") : t("kidLiveLocked"))}>{live.lockedToday ? t("kidUnlockToday") : t("kidLockToday")}</GaButton>
      {[15, 30].map(minutes => <GaButton key={minutes} icon={<Plus size={16} aria-hidden="true" />} disabled={off} onClick={() => void send("extend", minutes, t("kidLiveExtended", { minutes: String(minutes) }))}>{t("kidAddMinutes", { minutes: String(minutes) })}</GaButton>)}
    </div>
    <p className="ga-hint">{live.extraMinutes ? `${t("kidExtraToday", { minutes: String(live.extraMinutes) })} ` : ""}{live.lockedToday ? `${t("kidLockedToday")} ` : ""}{live.channel ? "" : t("kidLiveNeedsApply")}</p>
  </fieldset>;
}
