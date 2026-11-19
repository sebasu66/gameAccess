/**
 * A sheet over the whole window (Seba, 2026-11-18; docs/GUI_DESIGN.md §4.46): the same overlay as the wizard —the
 * window dims behind it and the smoke takes it— but with its content **centred** instead of filling the height, for
 * what is said once and answered once (how auto-compression works and how often it runs). It has no frame of its own:
 * it grows sideways and upwards as its content grows, and never taller than the window.
 *
 * One `ga-close` and Escape, as every overlay.
 */
import { useCallback, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../../dialogFocus";
import { useI18n } from "../../i18n";
import { GaClose } from "./Buttons";
import "./sheet.css";

export default function GaSheet({ title, eyebrow, lead, onClose, actions, children, className }: {
  title: string; eyebrow?: string; lead?: ReactNode; onClose: () => void; actions?: ReactNode; children?: ReactNode;
  /** A class for the whole overlay, so a screen's look (its font scope) reaches the portal. */ className?: string;
}) {
  const { t } = useI18n();
  const latest = useRef(onClose);
  latest.current = onClose;
  const escape = useCallback(() => latest.current(), []);
  const ref = useDialogFocus(escape);
  return createPortal(
    <div className={["ga-overlay-root ga-midsheet-root", className].filter(Boolean).join(" ")} role="presentation">
      <section ref={ref} className="ga-overlay-dialog ga-midsheet-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="ga-midsheet-head">
          <div className="ga-midsheet-titles">
            {eyebrow ? <span className="ga-midsheet-eyebrow">{eyebrow}</span> : null}
            <h2 className="ga-midsheet-title">{title}</h2>
          </div>
          <GaClose label={t("close")} onClick={onClose} />
        </header>
        {lead ? <p className="ga-midsheet-lead">{lead}</p> : null}
        <div className="ga-midsheet-body">{children}</div>
        {actions ? <div className="ga-midsheet-foot">{actions}</div> : null}
      </section>
    </div>,
    document.body);
}
