/**
 * A one-time process told step by step over the whole window (Seba, 2026-11-17): importing games, moving games into
 * the library. docs/GUI_DESIGN.md §4.37. The window dims behind it; the wizard takes the whole content column with the
 * eyebrow «Process · step N of M», the title, the named steps, a body that scrolls and a fixed row of buttons.
 * One `ga-close`, disabled while a step must not be left halfway; Escape does the same.
 */
import { useCallback, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useDialogFocus } from "../../dialogFocus";
import { useI18n } from "../../i18n";
import { GaClose } from "./Buttons";
import "./wizard.css";

export interface GaWizardProps {
  /** The process, said in the eyebrow ("Import games"). */
  process: string;
  /** The names of the steps, in order; `step` is the one on screen (0 based). */
  steps: string[];
  step: number;
  /** The title of this step. */
  title: string;
  /** The lead under the title: what this step asks for or says. */
  lead?: ReactNode;
  /** The step cannot be left now (a scan or a move running): close and Escape do nothing. */
  locked?: boolean;
  onClose: () => void;
  /** Left of the button row (Back). */
  back?: ReactNode;
  /** Right of the button row (the step's main action last). */
  actions?: ReactNode;
  children?: ReactNode;
  /** A class for the whole overlay, so a screen's look (its font scope) reaches the portal. */
  className?: string;
}

export default function GaWizard({ process, steps, step, title, lead, locked = false, onClose, back, actions, children, className }: GaWizardProps) {
  const { t } = useI18n();
  // The focus hook re-runs when its callback changes: one stable callback reads the latest state.
  const latest = useRef({ locked, onClose });
  latest.current = { locked, onClose };
  const escape = useCallback(() => { if (!latest.current.locked) latest.current.onClose(); }, []);
  const ref = useDialogFocus(escape);
  return createPortal(
    <div className={["ga-overlay-root ga-wizard-root", className].filter(Boolean).join(" ")} role="presentation">
      <section ref={ref} className="ga-overlay-dialog ga-wizard-panel" role="dialog" aria-modal="true" aria-label={`${process}: ${title}`} aria-busy={locked || undefined}>
        <header className="ga-wizard-head">
          <div className="ga-wizard-titles">
            <span className="ga-wizard-eyebrow">{t("wizardEyebrow", { process, step: step + 1, total: steps.length })}</span>
            <h2 className="ga-wizard-title">{title}</h2>
          </div>
          <GaClose label={t("close")} disabled={locked} onClick={onClose} />
        </header>
        <ol className="ga-wizard-steps" aria-label={t("wizardSteps")}>
          {steps.map((name, index) => <li key={name} className={index < step ? "is-done" : index === step ? "is-now" : undefined} aria-current={index === step ? "step" : undefined}>
            <span className="ga-wizard-step-mark" aria-hidden="true">{index < step ? <Check /> : index + 1}</span>
            <span className="ga-wizard-step-name">{name}</span>
          </li>)}
        </ol>
        <div className="ga-wizard-body">
          {lead ? <p className="ga-wizard-lead">{lead}</p> : null}
          {children}
        </div>
        {back || actions ? <footer className="ga-wizard-foot">
          <div className="ga-wizard-back">{back}</div>
          <div className="ga-wizard-actions">{actions}</div>
        </footer> : null}
      </section>
    </div>,
    document.body,
  );
}
