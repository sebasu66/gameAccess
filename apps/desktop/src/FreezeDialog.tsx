import { useEffect, useState } from "react";
import AppDialog from "./AppDialog";
import type { FreezeLevel } from "./catalog/DigitalProcessManager";
import { freezeJob, freezeTitle, startFreezeJob, watchFreezeJob, type FreezeJob } from "./freezeJobs";
import { useI18n } from "./i18n";
import type { CatalogGame } from "./types";

export type FreezeMode = FreezeLevel | "thaw";

/** Confirm, then freeze (either level) or thaw one game; the dialog narrates the work and shows the result.
 *  The work itself is a job of the app (freezeJobs): closing the dialog does not lose it, and reopening it
 *  while the game is still being compressed shows that same job. Closing it while it works is safe: the
 *  result then arrives as a toast. */
export default function FreezeDialog({ game, mode, onClose }: { game: CatalogGame; mode: FreezeMode; onClose: () => void }) {
  const { t } = useI18n();
  const [job, setJob] = useState<FreezeJob | undefined>(() => freezeJob(game.app_id ?? game.id));
  const [outcome, setOutcome] = useState<{ ok: boolean; detail: string } | null>(null);
  const shown = job?.mode ?? mode;
  const copy = {
    freeze: { body: t("freezeBody"), confirm: t("freezeMenu") },
    deep: { body: t("deepFreezeBody"), confirm: t("deepFreezeMenu") },
    thaw: { body: t("thawBody"), confirm: t("thawMenu") },
  }[shown];
  const title = freezeTitle(shown, game.name);
  useEffect(() => {
    if (!job) return;
    const unwatch = watchFreezeJob(job);
    let current = true;
    void job.done.then(result => { if (current) setOutcome(result); });
    return () => { current = false; unwatch(); };
  }, [job]);
  if (outcome && !outcome.ok) return <AppDialog title={title} message={outcome.detail} tone="error" onClose={onClose} />;
  const progress = outcome ? { phase: "done" as const, label: title, detail: outcome.detail }
    : job ? { phase: "working" as const, label: t(shown === "thaw" ? "thawWorking" : "freezeWorking"), detail: game.name } : undefined;
  return <AppDialog title={title} message={copy.body} onClose={onClose} progress={progress}
    onConfirm={() => setJob(startFreezeJob(game, mode))} confirmLabel={copy.confirm} cancelLabel={t("back")} confirmDisabled={Boolean(job)} initialAction="confirm" />;
}
