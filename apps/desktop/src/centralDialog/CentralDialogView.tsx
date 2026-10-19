import { Fragment, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Circle, Gamepad2, Loader2, Megaphone, MinusCircle, XCircle } from "lucide-react";
import { useI18n } from "../i18n";
import { centralDialog, type DialogState, type TaskStep } from "./centralDialog";
import "./central-dialog.css";

/** Paragraphs, "## " headings, "- " bullets and **bold**: the only formatting announcements use (no HTML). */
export function AnnouncementBody({ text }: { text: string }) {
  const inline = (line: string): ReactNode[] => line.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>);
  return <>{text.split(/\n\s*\n/).map((block, index) => {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length && lines.every(line => line.startsWith("- "))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.slice(2))}</li>)}</ul>;
    if (lines.length === 1 && lines[0].startsWith("## ")) return <h3 key={index}>{inline(lines[0].slice(3))}</h3>;
    return <p key={index}>{inline(lines.join(" "))}</p>;
  })}</>;
}

function amount(value: number, unit: TaskStep["unit"]): string {
  if (unit !== "bytes") return value.toLocaleString();
  return value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}

function stepLine(step: TaskStep, t: ReturnType<typeof useI18n>["t"]): string {
  const parts: string[] = [];
  if (step.done !== undefined && step.total) {
    parts.push(`${amount(step.done, step.unit)} / ${amount(step.total, step.unit)}`);
    const elapsed = step.startedAt ? (Date.now() - step.startedAt) / 1000 : 0;
    if (elapsed > 2 && step.done > 0 && step.done < step.total) {
      const left = Math.ceil((step.total - step.done) / (step.done / elapsed));
      parts.push(left >= 60 ? t("dialogMinutesLeft", { count: Math.ceil(left / 60) }) : t("dialogSecondsLeft", { count: left }));
    }
  } else if (step.done !== undefined) {
    parts.push(amount(step.done, step.unit));
  }
  if (step.detail) parts.unshift(step.detail);
  return parts.join(" · ");
}

const ICONS = {
  pending: <Circle size={18} />, running: <Loader2 size={18} className="spin" />, done: <CheckCircle2 size={18} />,
  skipped: <MinusCircle size={18} />, failed: <XCircle size={18} />,
};

export default function CentralDialogView() {
  const { t } = useI18n();
  const [state, setState] = useState<DialogState>(() => centralDialog.snapshot());
  const [page, setPage] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => centralDialog.subscribe(setState), []);
  useEffect(() => setPage(0), [state.announcements]);
  useEffect(() => {
    if (!state.task || !state.taskVisible) return;
    const timer = setInterval(() => tick(value => value + 1), 1000); // keeps the time left current
    return () => clearInterval(timer);
  }, [state.task, state.taskVisible]);

  const task = state.taskVisible ? state.task : null;
  const announcement = !state.task ? state.announcements[page] : undefined;
  if (!task && !announcement) return null;

  if (task) {
    const current = task.steps.find(step => step.state === "running");
    const percent = current?.total ? Math.min(100, (current.done ?? 0) / current.total * 100) : null;
    return <div className="central-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="central-dialog-title" aria-live="polite">
      <section className="central-dialog-card">
        <div className="central-dialog-brand"><Gamepad2 size={24} /><strong>gameAccess</strong></div>
        <h1 id="central-dialog-title">{task.failure ? t("dialogTaskFailed") : task.title}</h1>
        <ol className="central-dialog-steps">
          {task.steps.map(step => <li key={step.id} className={`step-${step.state}`}>
            {ICONS[step.state]}
            <span><strong>{step.label}</strong>{step.state === "running" || step.state === "failed" || step.detail ? <small>{stepLine(step, t)}</small> : null}</span>
          </li>)}
        </ol>
        {current && !task.failure ? <div className="central-dialog-progress" aria-label={current.label}>
          <div className={`central-dialog-progress-bar${percent === null ? " indeterminate" : ""}`} style={percent === null ? undefined : { width: `${percent}%` }} />
        </div> : null}
        {task.failure ? <>
          <p className="central-dialog-failure">{task.failure}</p>
          <div className="central-dialog-actions">
            {task.canRetry ? <button type="button" onClick={() => centralDialog.answerFailure("retry")}>{t("dialogRetry")}</button> : null}
            <button type="button" className="primary" onClick={() => centralDialog.answerFailure("continue")}>{t("dialogContinue")}</button>
          </div>
        </> : <p className="central-dialog-hint">{t("dialogWaitHint")}</p>}
      </section>
    </div>;
  }

  const count = state.announcements.length;
  const last = page >= count - 1;
  return <div className="central-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="central-dialog-title">
    <section className="central-dialog-card central-dialog-announcement">
      <div className="central-dialog-brand"><Megaphone size={22} /><strong>gameAccess</strong>{count > 1 ? <span className="central-dialog-pager">{page + 1} / {count}</span> : null}</div>
      <h1 id="central-dialog-title">{announcement!.title}</h1>
      <div className="central-dialog-body"><AnnouncementBody text={announcement!.body} /></div>
      <div className="central-dialog-actions">
        {page > 0 ? <button type="button" onClick={() => setPage(page - 1)}>{t("dialogPrevious")}</button> : null}
        <button type="button" className="primary" data-dialog-initial onClick={() => last ? centralDialog.closeAnnouncements() : setPage(page + 1)}>
          {last ? t("dialogUnderstood") : t("dialogNext")}
        </button>
      </div>
    </section>
  </div>;
}
