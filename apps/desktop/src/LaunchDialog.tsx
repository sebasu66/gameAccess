import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CircleCheck, Loader2, Wrench } from "lucide-react";

import { GaButton, GaClose } from "./components/ga/Buttons";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import type { ProcessExecutionResult } from "./catalog/DigitalProcessManager";
import { useDialogFocus } from "./dialogFocus";
import { useI18n } from "./i18n";
import { LAUNCH_LOCK_MS, closeLaunch, type LaunchSession } from "./launchSession";
import { launchProgress, type LaunchProgress } from "./native";
import "./launch-dialog.css";

type LaunchCheck = NonNullable<ProcessExecutionResult["checks"]>[number];

/** The animated drawing: a game pad inside a turning ring; red and still on error, green with a check once open. */
function LaunchArt({ mode }: { mode: "starting" | "error" | "opened" }) {
  return (
    <svg className={`ga-launch-art is-${mode}`} viewBox="0 0 160 120" role="presentation" aria-hidden="true">
      <circle className="ring ring-outer" cx="80" cy="60" r="52" />
      <circle className="ring ring-inner" cx="80" cy="60" r="42" />
      <g className="pad">
        <path d="M52 48c-8 0-14 6-16 16l-3 14c-1.5 7 6 10 11 5l9-9h54l9 9c5 5 12.5 2 11-5l-3-14c-2-10-8-16-16-16z" />
        <path className="dpad" d="M56 56v10M51 61h10" />
        <circle className="stick" cx="72" cy="63" r="3" />
        <circle className="stick" cx="90" cy="63" r="3" />
        <circle className="button b1" cx="106" cy="56" r="2.6" />
        <circle className="button b2" cx="112" cy="62" r="2.6" />
        <circle className="button b3" cx="106" cy="68" r="2.6" />
        <circle className="button b4" cx="100" cy="62" r="2.6" />
      </g>
      <g className="spark"><circle cx="80" cy="8" r="3" /><circle cx="132" cy="60" r="2.2" /><circle cx="28" cy="60" r="2.2" /></g>
      <path className="tick" d="M62 62l12 12 24-26" />
      <path className="cross" d="M66 46l28 28M94 46l-28 28" />
    </svg>
  );
}

/**
 * The one modal while a game starts (Seba, 2026-11-01). For LAUNCH_LOCK_MS nothing behind it can be used and it cannot
 * be closed; it shows a drawing and the launcher's live log. If the game has not opened by then (or the launch fails)
 * it turns into the error mode: the usual causes checked and the ways to try again.
 */
export default function LaunchDialog({ session, onRetry }: { session: LaunchSession; onRetry: (game: LaunchSession["game"], autoFixed: boolean) => void }) {
  const { t } = useI18n();
  const { game } = session;
  const appId = game.app_id ?? game.id;
  const [now, setNow] = useState(() => Date.now());
  const [progress, setProgress] = useState<LaunchProgress | null>(null);
  const [checks, setChecks] = useState<LaunchCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const elapsed = now - session.startedAt;
  const slow = session.phase === "starting" && elapsed >= LAUNCH_LOCK_MS;
  const errorMode = session.phase === "failed" || slow;
  const locked = session.phase === "starting" && !slow;
  const mode = session.phase === "opened" ? "opened" : errorMode ? "error" : "starting";

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer); }, []);
  // The live log: what the launcher writes while it prepares and starts the game.
  useEffect(() => {
    if (session.phase === "opened") return;
    let live = true;
    const read = async () => {
      const found = await launchProgress(appId);
      if (live && found && found.started_at * 1000 >= session.startedAt - 4000) setProgress(found);
    };
    void read();
    const timer = window.setInterval(() => void read(), 400);
    return () => { live = false; window.clearInterval(timer); };
  }, [appId, session.startedAt, session.phase]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [progress?.lines.length]);
  // Error mode: look for the usual causes, once.
  const diagnosed = useRef(false);
  useEffect(() => {
    if (!errorMode || diagnosed.current) return;
    diagnosed.current = true;
    void digitalProcessManager.diagnoseLaunch(game).then(result => setChecks(result.checks ?? [])).catch(() => setChecks([]));
  }, [errorMode, game]);
  // Once open, the dialog says so and leaves.
  useEffect(() => {
    if (session.phase !== "opened") return;
    const timer = window.setTimeout(() => closeLaunch(session.id), 1400);
    return () => window.clearTimeout(timer);
  }, [session.phase, session.id]);

  const close = () => { if (!locked) closeLaunch(session.id); };
  const ref = useDialogFocus(close);
  const lines = progress?.lines ?? [];

  const failing = (id: string) => checks?.some(check => check.id === id && check.ok === false) ?? false;
  const rows = useMemo(() => (checks ?? []).flatMap(check => {
    const bad = check.ok === false;
    const row = (text: string) => [{ id: check.id, bad, text }];
    switch (check.id) {
      case "path_length": return row(bad ? t("launchDlgPathLong", { length: Number(check.length), limit: Number(check.limit) }) : t("launchDlgPathOk", { length: Number(check.length) }));
      case "path_symbols": return row(bad ? t("launchDlgSymbolsBad", { path: String(check.path) }) : t("launchDlgSymbolsOk"));
      case "steam_running": return row(bad ? t("launchDlgSteamBad") : t("launchDlgSteamOk"));
      case "antivirus": {
        if (!bad) return row(t("launchDlgAvOk"));
        const threats = (check.threats as string[] | undefined) ?? [];
        return [...(check.missing ? row(t("launchDlgAvMissing", { file: String(check.missing) })) : []), ...(threats.length ? row(t("launchDlgAvThreats", { files: threats.join(", ") })) : [])];
      }
      case "runtimes": return row(bad ? t("launchDlgRuntimesBad", { list: ((check.missing as string[] | undefined) ?? []).join(", ") }) : t("launchDlgRuntimesOk"));
      case "gpu_driver": return row(bad ? t("launchDlgDriverOld", { name: String(check.name), date: String(check.date) }) : t("launchDlgDriverOk", { name: String(check.name), date: String(check.date) }));
      case "language_forced": return row(t("launchDlgLanguageForced"));
      case "frozen": return row(t("launchDlgFrozen"));
      default: return [];
    }
  }).sort((a, b) => Number(b.bad) - Number(a.bad)), [checks, t]);

  const work = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch (error) { setNote(String(error instanceof Error ? error.message : error)); } finally { setBusy(false); }
  };
  // Automatic fix: tries the usual alternatives inside (thaw if frozen, put the game's language files back and stop
  // touching them, then check the causes again) and launches once more; if that fails too, only the exe's folder is offered.
  const autoFix = () => void work(async () => {
    setNote(t("launchDlgAutoFixing"));
    await digitalProcessManager.autoFix(game);
    closeLaunch(session.id);
    onRetry(game, true);
  });
  const title = mode === "opened" ? t("launchDlgOpened", { name: game.name })
    : session.phase === "failed" ? t("launchDlgFailedTitle", { name: game.name })
    : slow ? t("launchDlgSlowTitle", { name: game.name }) : t("launchDlgStarting", { name: game.name });
  const text = mode === "opened" ? t("launchPlayingText", { name: game.name })
    : session.phase === "failed" ? session.error : slow ? t("launchDlgSlowText") : t("launchDlgStartingText");

  return (
    <div className="ga-dialog-backdrop ga-launch-backdrop" role="presentation" onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
      <section ref={ref} className={`ga-dialog ga-launch is-${mode}`} role="alertdialog" aria-modal="true" aria-busy={locked || undefined} aria-labelledby="ga-launch-title">
        {locked ? null : <GaClose label={t("close")} className="ga-launch-close" onClick={close} data-dialog-initial />}
        <header>
          <LaunchArt mode={mode} />
          <div className="ga-launch-head">
            <span className="ga-dialog-eyebrow">{t("launchDlgEyebrow")}</span>
            <h2 id="ga-launch-title" className="ga-launch-title">{title}</h2>
            <p role="status" aria-live="polite">{text}</p>
            {locked ? <span className="ga-launch-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (elapsed / LAUNCH_LOCK_MS) * 100)}%` }} /></span> : null}
          </div>
        </header>

        {errorMode && (checks === null || rows.length) ? <section className="ga-launch-checks" aria-label={t("launchDlgChecksLabel")}>
          <span className="ga-label">{t("launchDlgChecksLabel")}</span>
          {checks === null ? <p className="ga-launch-checking"><Loader2 size={15} className="ga-dialog-spin" aria-hidden="true" /> {t("launchDlgChecking")}</p>
            : <ul>{rows.map((row, index) => <li key={`${row.id}-${index}`} className={row.bad ? "bad" : "ok"}>{row.bad ? <AlertTriangle size={15} aria-hidden="true" /> : <CircleCheck size={15} aria-hidden="true" />}<span>{row.text}</span></li>)}</ul>}
        </section> : null}

        <section className="ga-launch-log-wrap" aria-label={t("launchDlgLogLabel")}>
          <span className="ga-label">{t("launchDlgLogLabel")}</span>
          <div className="ga-launch-log" ref={logRef}>
            {lines.length ? lines.map((line, index) => <div key={index} className={line.level === "WARNING" || line.level === "ERROR" ? "warn" : undefined}><time>{line.at.toFixed(1)}s</time><span>{line.text}</span></div>)
              : <div className="idle"><time>0.0s</time><span>{t("launchDlgLogEmpty")}</span></div>}
            {mode === "starting" ? <div className="cursor" aria-hidden="true">▌</div> : null}
          </div>
        </section>
        {note ? <p className="ga-launch-note" role="status">{note}</p> : null}

        {errorMode ? <footer>
          {session.autoFixed
            ? <GaButton variant="primary" disabled={busy} onClick={() => void work(async () => { await digitalProcessManager.openFolder(game, "exe"); })}>{t("launchDlgOpenExe")}</GaButton>
            : <GaButton variant="primary" disabled={busy || checks === null} onClick={autoFix} icon={busy ? <Loader2 size={16} className="ga-dialog-spin" aria-hidden="true" /> : <Wrench size={16} aria-hidden="true" />}>{t("launchDlgAutoFix")}</GaButton>}
          <GaButton disabled={busy} onClick={close}>{t("noticeCancel")}</GaButton>
        </footer> : null}
      </section>
    </div>
  );
}
