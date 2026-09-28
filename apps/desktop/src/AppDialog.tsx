import { AlertTriangle, Info } from "lucide-react";

import { useDialogFocus } from "./dialogFocus";

interface AppDialogProps {
  title: string;
  message: string;
  tone?: "info" | "warning" | "error";
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
}

export default function AppDialog({ title, message, tone = "info", confirmLabel, cancelLabel, confirmDisabled = false, onConfirm, onClose }: AppDialogProps) {
  const dialogRef = useDialogFocus(onClose);
  const isAlert = tone === "warning" || tone === "error";
  const actionsLabel = onConfirm ? "Confirmar o cancelar" : "Cerrar";
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
              <button type="button" className="secondary-button" data-dialog-initial onClick={onClose}>{cancelLabel ?? "Volver"}</button>
              <button type="button" className="primary-button" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel ?? "Confirmar"}</button>
            </> : <button type="button" className="primary-button" data-dialog-initial onClick={onClose}>Entendido</button>}
          </div>
        </div>
      </section>
    </div>
  );
}
