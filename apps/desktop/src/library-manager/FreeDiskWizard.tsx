/**
 * Freeing a disk (Seba, 2026-11-18; docs/GUI_DESIGN.md §4.37 and §4.45): Manager › Space opens it from one button and
 * the whole thing happens here, over the window — choosing, the moving and how it ended — because while the games of
 * a disk are moving nothing else can be done with the library.
 *
 * Step 1 asks which disk to empty and where its games should go, and says what that means before anything moves (how
 * many games, how much, and what does not fit). Step 2 moves them one by one and can be cancelled: the game being
 * copied stays where it was and the ones already moved stay moved. Step 3 says how it ended.
 */
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import GaWizard from "../components/ga/Wizard";
import { GaButton } from "../components/ga/Buttons";
import type { DriveEvacuation, LibraryDrive } from "../catalog/DigitalProcessManager";
import { cancelFreeDisk, dismissFreeDisk, planFreeDisk, startFreeDisk, useDiskBatch } from "./libraryDrives";
import { formatBytes } from "./format";

const failText = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);

export default function FreeDiskWizard({ drives, onClose }: { drives: LibraryDrive[]; onClose: () => void }) {
  const { t } = useI18n();
  const job = useDiskBatch();
  const sources = drives.filter(drive => drive.games > 0);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("auto");
  const [plan, setPlan] = useState<DriveEvacuation | null>(null);
  const [problem, setProblem] = useState("");
  const [working, setWorking] = useState(false);
  const from = sources.some(drive => drive.letter === source) ? source : sources[0]?.letter ?? "";
  const targets = drives.filter(drive => drive.roles?.install && drive.letter !== from);
  const to = target === "auto" || targets.some(drive => drive.letter === target) ? target : "auto";
  const steps = [t("spaceFreeStepPick"), t("spaceFreeStepMove"), t("spaceFreeStepDone")];
  const step = !job ? 0 : job.finished ? 2 : 1;

  // What this would move, worked out before anything happens (the launcher's own plan, nothing is written).
  useEffect(() => {
    if (!from || !targets.length || job) { setPlan(null); return undefined; }
    let alive = true;
    setPlan(null); setProblem("");
    void planFreeDisk(from, to).then(found => { if (alive) setPlan(found); }).catch(failure => { if (alive) setProblem(failText(failure)); });
    return () => { alive = false; };
  }, [from, to, targets.length, Boolean(job)]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    setWorking(true); setProblem("");
    try {
      const started = await startFreeDisk(from, to);
      if (started.error) setProblem(started.error);
      else if (!started.ok) setProblem(t("spaceFreeShort", { list: (started.short ?? []).map(item => t("spaceFreeShortItem", { drive: item.drive, size: formatBytes(item.missing_bytes) })).join(", ") }));
      else if (!started.moves?.length) setProblem(t("spaceFreeNothing", { drive: from }));
    } catch (failure) { setProblem(failText(failure)); }
    finally { setWorking(false); }
  };
  const close = () => { dismissFreeDisk(); onClose(); };

  if (job && !job.finished) {
    const move = job.moves[job.done];
    return <GaWizard className="ga-manager-scope" process={t("spaceFreeProcess")} steps={steps} step={1} title={t("spaceFreeWorkTitle", { drive: job.source })} locked onClose={close}
      lead={t("spaceFreeRunning", { done: job.done, total: job.moves.length, drive: job.source })}
      actions={<GaButton disabled={job.cancelled} onClick={cancelFreeDisk}>{t("spaceFreeCancel")}</GaButton>}>
      <p className="ga-hint">{job.cancelled ? t("spaceFreeStopping") : move ? t("spaceFreeMoving", { name: move.name, drive: move.target }) : ""}</p>
    </GaWizard>;
  }
  if (job?.finished) {
    return <GaWizard className="ga-manager-scope" process={t("spaceFreeProcess")} steps={steps} step={2} title={t("spaceFreeDoneTitle")} onClose={close}
      lead={t(job.cancelled ? "spaceFreeCancelled" : "spaceFreeDone", { done: job.done, total: job.moves.length, drive: job.source })}
      actions={<GaButton variant="primary" onClick={close}>{t("spaceFreeDismiss")}</GaButton>}>
      <p className="ga-hint">{t("spaceFreeAfter", { drive: job.source })}</p>
    </GaWizard>;
  }
  const count = plan?.moves?.length ?? 0;
  const short = plan && !plan.ok ? (plan.short ?? []).map(item => t("spaceFreeShortItem", { drive: item.drive, size: formatBytes(item.missing_bytes) })).join(", ") : "";
  return <GaWizard className="ga-manager-scope" process={t("spaceFreeProcess")} steps={steps} step={0} title={t("spaceFreePickTitle")} lead={t("spaceFreeLead")} onClose={close}
    actions={<>
      <GaButton onClick={close}>{t("noticeCancel")}</GaButton>
      <GaButton variant="primary" disabled={!from || !targets.length || working || !count || Boolean(short)} onClick={() => void go()}>
        {working ? t("spaceFreeChecking") : t("spaceFreeGoDrive", { drive: from || "—" })}
      </GaButton>
    </>}>
    <div className="ga-stack">
      <div className="lm-space-free">
        <label className="lm-space-step"><span>{t("spaceFreeFrom")}</span>
          <select className="ga-settings-select" value={from} disabled={!sources.length} onChange={event => setSource(event.target.value)}>
            {sources.length ? sources.map(drive => <option key={drive.letter} value={drive.letter}>{t("spaceFreeFromOption", { drive: drive.letter, count: drive.games })}</option>) : <option value="">{t("spaceFreeNoSource")}</option>}
          </select></label>
        <label className="lm-space-step"><span>{t("spaceFreeTo")}</span>
          <select className="ga-settings-select" value={to} disabled={!targets.length} onChange={event => setTarget(event.target.value)}>
            <option value="auto">{t("spaceFreeAuto")}</option>
            {targets.map(drive => <option key={drive.letter} value={drive.letter}>{drive.letter}{drive.name ? ` · ${drive.name}` : ""}</option>)}
          </select></label>
      </div>
      {!sources.length ? <p className="ga-hint">{t("spaceFreeNoSource")}</p>
        : !targets.length ? <p role="alert" className="ga-status is-warn">{t("spaceFreeNoTarget")}</p>
        : problem ? <p role="alert" className="ga-status is-warn">{problem}</p>
        : short ? <p role="alert" className="ga-status is-warn">{t("spaceFreeShortPlan", { list: short })}</p>
        : plan ? <p role="status" className="ga-status is-ok">{count ? t("spaceFreePlan", { count, size: formatBytes(plan.bytes ?? 0), drive: from }) : t("spaceFreeNothing", { drive: from })}</p>
        : <p className="ga-hint">{t("spaceFreeChecking")}</p>}
      <p className="ga-hint">{t("spaceFreeWarn")}</p>
    </div>
  </GaWizard>;
}
