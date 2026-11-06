import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Gamepad2, ShieldAlert } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "./components/ui/alert-dialog";
import { GaButton, GaClose } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { useOpeningSettled } from "./centralDialog/openingSettled";
import { centralDialog } from "./centralDialog/centralDialog";
import { showNotice } from "./notice/notice";
import { uiDemo } from "./devDemo/uiDemo";
import { hasTauriRuntime } from "./native";
import {
  ANTIVIRUS_CHECK_EVENT, ANTIVIRUS_SOLVED_EVENT, addExclusions, antivirusDismissed, antivirusState, dismissAntivirus, excludedByHand, markExcludedByHand,
  openWindowsSecurity, probeAntivirus, type AntivirusState,
} from "./antivirusExclusion";
import "./antivirus-dialog.css";

type Open = { state: Exclude<AntivirusState, { kind: "covered" }>; folders: string[] };

/** The direct-download folders: the games folder and the temporary downloads folder (Settings › Downloads and games). */
async function directDownloadFolders(): Promise<string[]> {
  if (import.meta.env.DEV && uiDemo() && !hasTauriRuntime()) return ["C:\\GA_Juegos", "C:\\Users\\ana\\Downloads\\GameAccessDownloads"];
  const settings = (await digitalProcessManager.settings().catch(() => undefined))?.settings;
  return settings ? [settings.games_root, settings.temporary_root].filter(Boolean) : [];
}

/** What the antivirus means for these folders now, or null when there is nothing to say. */
export async function checkAntivirus(): Promise<Open | null> {
  const folders = await directDownloadFolders();
  if (!folders.length) return null;
  const probe = await probeAntivirus();
  if (!probe) return null;
  const state = antivirusState(probe, folders, excludedByHand());
  return state.kind === "covered" ? null : { state, folders };
}

/**
 * Asks once, after the opening, whether the antivirus may leave the direct-download folders alone (also after the
 * games folder changes, `requestAntivirusCheck`, and by hand from Settings, `openAntivirusDialog`). "No, thanks" or
 * closing it is kept for those folders. Not shown in a child's account (kid mode has its own screen).
 */
export default function AntivirusGate() {
  const settled = useOpeningSettled();
  const [open, setOpen] = useState<Open | null>(null);
  const checking = useRef(false);
  const check = useCallback(async (manual: boolean) => {
    if (checking.current) return;
    checking.current = true;
    try {
      const found = await checkAntivirus();
      if (found && (manual || !antivirusDismissed(found.folders))) setOpen(found);
    } finally { checking.current = false; }
  }, []);
  useEffect(() => { if (settled) void check(false); }, [settled, check]);
  useEffect(() => {
    const onCheck = (event: Event) => void check(Boolean((event as CustomEvent<{ manual?: boolean }>).detail?.manual));
    window.addEventListener(ANTIVIRUS_CHECK_EVENT, onCheck);
    return () => window.removeEventListener(ANTIVIRUS_CHECK_EVENT, onCheck);
  }, [check]);
  // One dialog at a time (GUI_DESIGN §4.6): it waits while the central dialog (welcome, news, a long task) is up.
  const [centralBusy, setCentralBusy] = useState(false);
  useEffect(() => centralDialog.subscribe(state => setCentralBusy(state.taskVisible || state.announcements.length > 0)), []);
  if (!open || centralBusy) return null;
  return <AntivirusDialog state={open.state} folders={open.folders} onClose={() => { dismissAntivirus(open.folders); setOpen(null); }} onSolved={() => { setOpen(null); window.dispatchEvent(new Event(ANTIVIRUS_SOLVED_EVENT)); }} />;
}

/**
 * The dialog (docs/GUI_DESIGN.md §4.26, like KidReadyDialog): why it is needed and that it is only for direct
 * download, as two cards; the folders; one orange action. Defender: "Add the exclusion" (one Windows permission
 * question). Another antivirus, an organization's Defender, a refused permission or a failure: the steps by hand,
 * with Windows Security's page (Defender) or the folders to paste, and "I did it".
 */
export function AntivirusDialog({ state, folders, onClose, onSolved }: { state: Open["state"]; folders: string[]; onClose: () => void; onSolved: () => void }) {
  const { t } = useI18n();
  const [manual, setManual] = useState(state.kind !== "missing");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "warn" | "error" | "ok"; text: string } | null>(null);
  const missing = state.missing;
  const product = state.kind === "other" ? state.product : "";

  const add = async () => {
    setBusy(true); setNote(null);
    try {
      const outcome = await addExclusions(missing);
      if (outcome.failed.length || outcome.managed) {
        setManual(true);
        setNote({ tone: "error", text: t("avFailed", { error: outcome.error || outcome.failed.join(", ") }) });
        return;
      }
      showNotice({ title: t("avDoneTitle"), text: t("avDone"), tone: "ok" });
      onSolved();
    } catch (error) {
      const said = String(error instanceof Error ? error.message : error);
      if (said === "cancelled") setNote({ tone: "warn", text: t("avCancelled") });
      else { setManual(true); setNote({ tone: "error", text: t("avFailed", { error: said }) }); }
    } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(missing.join("\r\n")); setNote({ tone: "ok", text: t("avCopied") }); } catch { /* the folders stay visible to copy by hand */ }
  };
  const didIt = () => { markExcludedByHand(missing); onSolved(); };

  const lead = state.kind === "other" ? t("avLeadOther", { product }) : state.kind === "managed" ? t("avLeadManaged") : manual ? t("avLeadManual") : t("avLead");
  const steps = state.kind === "other" ? [t("avOtherStep1", { product }), t("avOtherStep2"), t("avOtherStep3")] : [t("avStep1"), t("avStep2"), t("avStep3")];

  return <AlertDialog open onOpenChange={next => { if (!next && !busy) onClose(); }}>
    <AlertDialogContent className="ga-overlay-dialog ga-av" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <header className="ga-av-head">
        <div className="ga-av-titles">
          <span className="eyebrow">{t("avEyebrow")}</span>
          <AlertDialogTitle className="ga-av-title">{t("avTitle")}</AlertDialogTitle>
        </div>
        <GaClose label={t("close")} onClick={onClose} disabled={busy} />
      </header>
      <div className="ga-av-scroll">
        <div className="ga-av-intro">
          <AlertDialogDescription className="ga-av-lead">{lead}</AlertDialogDescription>
        </div>
        <section className="ga-av-notes">
          <article className="ga-av-note is-warn">
            <span className="ga-av-note-icon"><ShieldAlert size={20} aria-hidden="true" /></span>
            <div className="ga-av-note-body">
              <h4 className="ga-av-note-title">{t("avWhyTitle")}</h4>
              <p>{t("avWhyText")}</p>
            </div>
          </article>
          <article className="ga-av-note is-ok">
            <span className="ga-av-note-icon"><Gamepad2 size={20} aria-hidden="true" /></span>
            <div className="ga-av-note-body">
              <h4 className="ga-av-note-title">{t("avOnlyTitle")}</h4>
              <p>{t("avOnlyText")}</p>
            </div>
          </article>
        </section>
        <section className="ga-av-section">
          <h3 className="ga-label">{t("avFolders")}</h3>
          <ul className="ga-av-folders">{(missing.length ? missing : folders).map(folder => <li key={folder}><code>{folder}</code></li>)}</ul>
        </section>
        {manual ? <section className="ga-av-section">
          <h3 className="ga-label">{t("avStepsTitle")}</h3>
          <ol className="ga-av-steps">{steps.map(step => <li key={step}>{step}</li>)}</ol>
        </section> : null}
        {note ? <p role="status" className={`ga-status is-${note.tone} ga-av-note-line`}>{note.text}</p> : null}
      </div>
      <footer className="ga-av-foot ga-actions">
        {!manual ? <>
          <GaButton variant="primary" disabled={busy} onClick={() => void add()}>{busy ? t("avAdding") : t("avAdd")}</GaButton>
          <GaButton disabled={busy} onClick={() => { setManual(true); setNote(null); }}>{t("avManual")}</GaButton>
        </> : state.kind === "missing" ? <>
          <GaButton variant="primary" icon={<ExternalLink size={18} aria-hidden="true" />} onClick={() => void openWindowsSecurity()}>{t("avOpenSecurity")}</GaButton>
          <GaButton icon={<Copy size={18} aria-hidden="true" />} onClick={() => void copy()}>{t("avCopy")}</GaButton>
          <GaButton onClick={didIt}>{t("avDidIt")}</GaButton>
        </> : <>
          <GaButton variant="primary" icon={<Copy size={18} aria-hidden="true" />} onClick={() => void copy()}>{t("avCopy")}</GaButton>
          <GaButton onClick={didIt}>{t("avDidIt")}</GaButton>
        </>}
        <GaButton disabled={busy} onClick={onClose}>{t("avNoThanks")}</GaButton>
      </footer>
    </AlertDialogContent>
  </AlertDialog>;
}
