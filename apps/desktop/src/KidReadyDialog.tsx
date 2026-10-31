import { Gamepad2, KeyRound, PartyPopper } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog";
import { GaButton, GaClose } from "./components/ga/Buttons";
import { useI18n } from "./i18n";

/**
 * The end of the kid mode wizard (vault/Modo niño.md, MN.27; Seba, 2026-10-31): a formal confirmation, large, that
 * the child's account was made and how it works, with the notes that apply. `protectedAccount` false: the parent's
 * Windows account has no password, so the child could pick it on the sign-in screen; it advises one and explains how,
 * folded (nothing is changed for the parent). `steam`: the child's games include Steam ones, which ask to sign in the
 * first time in the new account.
 */
export default function KidReadyDialog({ name, protectedAccount, steam, onClose }: { name: string; protectedAccount: boolean | null; steam: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const unprotected = protectedAccount === false;
  return <AlertDialog open onOpenChange={open => { if (!open) onClose(); }}>
    <AlertDialogContent className="ga-overlay-dialog ga-kid-ready">
      <AlertDialogHeader>
        <div className="ga-kid-ready-head">
          <div className="ga-stack ga-stack-sm">
            <span className="eyebrow">GAME ACCESS</span>
            <AlertDialogTitle className="ga-heading"><PartyPopper size={22} aria-hidden="true" /> {t("kidReadyTitle", { name })}</AlertDialogTitle>
          </div>
          <GaClose label={t("close")} onClick={onClose} />
        </div>
        <AlertDialogDescription className="ga-kid-ready-lead">{t("kidReadyText", { name })}</AlertDialogDescription>
      </AlertDialogHeader>
      {unprotected || steam ? <section className="ga-stack" aria-label={t("kidReadyNotes")}>
        <h3 className="ga-label">{t("kidReadyNotes")}</h3>
        {unprotected ? <div className="ga-group ga-stack ga-stack-sm">
          <p className="ga-status is-warn"><KeyRound size={16} aria-hidden="true" /> <strong>{t("kidReadyProtectTitle")}</strong></p>
          <p>{t("kidReadyProtectText", { name })}</p>
          <details className="ga-disclosure">
            <summary>{t("kidReadyProtectHow")}</summary>
            <ol className="ga-stack ga-stack-sm">
              <li>{t("kidReadyProtectStep1")}</li>
              <li>{t("kidReadyProtectStep2")}</li>
              <li>{t("kidReadyProtectStep3")}</li>
            </ol>
          </details>
        </div> : null}
        {steam ? <div className="ga-group ga-stack ga-stack-sm">
          <p className="ga-status is-ok"><Gamepad2 size={16} aria-hidden="true" /> <strong>{t("kidReadySteamTitle")}</strong></p>
          <p>{t("kidReadySteamText", { name })}</p>
        </div> : null}
      </section> : null}
      <AlertDialogFooter>
        <GaButton variant="primary" onClick={onClose}>{t("understood")}</GaButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
