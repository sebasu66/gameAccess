import { Gamepad2, KeyRound } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "./components/ui/alert-dialog";
import { GaButton, GaClose } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import "./kid-mode.css";

/**
 * The end of the kid mode wizard (vault/Modo niño.md, MN.27; Seba, 2026-10-31): a formal confirmation, large, that
 * the child's account was made and how it works, with the notes that apply. `protectedAccount` false: the parent's
 * Windows account has no password, so the child could pick it on the sign-in screen; it advises one and explains how,
 * folded (nothing is changed for the parent). `steam`: the child's games include Steam ones, which ask to sign in the
 * first time in the new account.
 * Layout (kid-mode.css): the standard dialog header (eyebrow, big title, close button, a line under it), the lead text
 * larger than the notes, and each note as a card with its icon and a title above its text.
 */
export default function KidReadyDialog({ name, protectedAccount, steam, onClose }: { name: string; protectedAccount: boolean | null; steam: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const unprotected = protectedAccount === false;
  return <AlertDialog open onOpenChange={open => { if (!open) onClose(); }}>
    <AlertDialogContent className="ga-overlay-dialog ga-kid-ready">
      <header className="ga-kid-ready-head">
        <div className="ga-kid-ready-titles">
          <span className="eyebrow">GAME ACCESS</span>
          <AlertDialogTitle className="ga-kid-ready-title">{t("kidReadyTitle", { name })}</AlertDialogTitle>
        </div>
        <GaClose label={t("close")} onClick={onClose} />
      </header>
      <div className="ga-kid-ready-scroll">
        <div className="ga-kid-ready-intro">
          <AlertDialogDescription className="ga-kid-ready-lead">{t("kidReadyText", { name })}</AlertDialogDescription>
        </div>
        {unprotected || steam ? <section className="ga-kid-ready-notes" aria-label={t("kidReadyNotes")}>
          <h3 className="ga-label">{t("kidReadyNotes")}</h3>
          {unprotected ? <article className="ga-kid-ready-note is-warn">
            <span className="ga-kid-ready-note-icon"><KeyRound size={20} aria-hidden="true" /></span>
            <div className="ga-kid-ready-note-body">
              <h4 className="ga-kid-ready-note-title">{t("kidReadyProtectTitle")}</h4>
              <p>{t("kidReadyProtectText", { name })}</p>
              <details className="ga-disclosure">
                <summary>{t("kidReadyProtectHow")}</summary>
                <ol>
                  <li>{t("kidReadyProtectStep1")}</li>
                  <li>{t("kidReadyProtectStep2")}</li>
                  <li>{t("kidReadyProtectStep3")}</li>
                </ol>
              </details>
            </div>
          </article> : null}
          {steam ? <article className="ga-kid-ready-note is-ok">
            <span className="ga-kid-ready-note-icon"><Gamepad2 size={20} aria-hidden="true" /></span>
            <div className="ga-kid-ready-note-body">
              <h4 className="ga-kid-ready-note-title">{t("kidReadySteamTitle")}</h4>
              <p>{t("kidReadySteamText", { name })}</p>
            </div>
          </article> : null}
        </section> : null}
      </div>
      <footer className="ga-kid-ready-foot">
        <GaButton variant="primary" onClick={onClose}>{t("understood")}</GaButton>
      </footer>
    </AlertDialogContent>
  </AlertDialog>;
}
