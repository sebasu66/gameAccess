import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";

import { useDialogFocus } from "./dialogFocus";
import { useI18n } from "./i18n";

interface AppDialogProps {
  title: string;
  message: string;
  tone?: "info" | "warning" | "error";
  confirmLabel?: string;
  cancelLabel?: string;
  onCancelAction?: () => void;
  cancelDisabled?: boolean;
  confirmDisabled?: boolean;
  initialAction?: "confirm" | "cancel";
  onConfirm?: () => void;
  onClose: () => void;
  /** The only button's text when there is nothing to confirm (Cancel beside a field); the field then takes the focus. */
  closeLabel?: string;
  /** Shows what a confirmed action is doing inside this same dialog, then its result. */
  progress?: { phase: "working" | "done"; label: string; detail?: string };
  /** Extra content under the message, such as a text field. */
  children?: ReactNode;
}

export default function AppDialog({ title, message, tone = "info", confirmLabel, cancelLabel, onCancelAction, cancelDisabled = false, confirmDisabled = false, initialAction = "cancel", onConfirm, onClose, closeLabel, progress, children }: AppDialogProps) {
  const dialogRef = useDialogFocus(onClose);
  const { t } = useI18n();
  const isAlert = tone === "warning" || tone === "error";
  const actionsLabel = onConfirm ? t("confirmOrCancel") : t("close");
  const working = progress?.phase === "working";
  const done = progress?.phase === "done";
  const tag = working ? "working" : done ? "done" : isAlert ? "alert" : "info";
  return (
    <div className="ga-dialog-backdrop" role="presentation" onPointerDown={event => event.stopPropagation()}>
      <section ref={dialogRef} className={`ga-dialog ga-dialog-${tag}`} role="alertdialog" aria-modal="true" aria-label={title} aria-describedby="app-dialog-message" aria-busy={working || undefined}>
        <div className="ga-dialog-icon" aria-hidden="true">
          {working ? <Loader2 size={24} className="ga-dialog-spin" /> : done ? <CheckCircle2 size={24} /> : isAlert ? <AlertTriangle size={24} /> : <Info size={24} />}
        </div>
        <span className="ga-dialog-eyebrow">GAME ACCESS</span>
        <h2>{title}</h2>
        {progress ? <div id="app-dialog-message" className="ga-dialog-progress" role="status" aria-live="polite">
          <p>{progress.label}</p>
          {working ? <span className="ga-dialog-bar" aria-hidden="true"><span /></span> : null}
          {progress.detail ? <small>{progress.detail}</small> : null}
        </div> : <p id="app-dialog-message">{message}</p>}
        {progress ? null : children}
        {working ? null : <div className="ga-dialog-actions" role="group" aria-label={actionsLabel}>
          {onConfirm && !done ? <>
            <button type="button" className="ga-dialog-secondary" data-dialog-initial={initialAction === "cancel" ? "" : undefined} disabled={cancelDisabled} onClick={onCancelAction ?? onClose}>{cancelLabel ?? t("back")}</button>
            <button type="button" className={`ga-dialog-primary${tone === "warning" ? " is-danger" : ""}`} data-dialog-initial={initialAction === "confirm" ? "" : undefined} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel ?? t("confirm")}</button>
          </> : closeLabel && !done ? <button type="button" className="ga-dialog-secondary" onClick={onClose}>{closeLabel}</button>
            : <button type="button" className="ga-dialog-primary" data-dialog-initial onClick={onClose}>{done ? t("close") : t("understood")}</button>}
        </div>}
      </section>
    </div>
  );
}
