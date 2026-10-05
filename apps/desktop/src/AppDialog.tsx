import { AlertTriangle, Info } from "lucide-react";

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
}

export default function AppDialog({ title, message, tone = "info", confirmLabel, cancelLabel, onCancelAction, cancelDisabled = false, confirmDisabled = false, initialAction = "cancel", onConfirm, onClose }: AppDialogProps) {
  const dialogRef = useDialogFocus(onClose);
  const { t } = useI18n();
  const isAlert = tone === "warning" || tone === "error";
  const actionsLabel = onConfirm ? t("confirmOrCancel") : t("close");
  return (
    <div className="session-backdrop app-dialog-backdrop" role="presentation" onPointerDown={event => event.stopPropagation()}>
      <section ref={dialogRef} className="session-card app-dialog-card" role="alertdialog" aria-modal="true" aria-label={title} aria-describedby="app-dialog-message">
        <div className="session-shade" />
        <div className="session-content">
          <div className={`session-status-icon ${isAlert ? "error" : "success"}`}>{isAlert ? <AlertTriangle size={26} /> : <Info size={26} />}</div>
          <span className="eyebrow">GAME ACCESS</span>
          <h2>{title}</h2>
          <p id="app-dialog-message">{message}</p>
          <div className="download-complete-actions app-dialog-actions" role="group" aria-label={actionsLabel}>
            {onConfirm ? <>
              <button type="button" className="secondary-button" data-dialog-initial={initialAction === "cancel" ? "" : undefined} disabled={cancelDisabled} onClick={onCancelAction ?? onClose}>{cancelLabel ?? t("back")}</button>
              <button type="button" className="primary-button" data-dialog-initial={initialAction === "confirm" ? "" : undefined} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel ?? t("confirm")}</button>
            </> : <button type="button" className="primary-button" data-dialog-initial onClick={onClose}>{t("understood")}</button>}
          </div>
        </div>
      </section>
    </div>
  );
}
