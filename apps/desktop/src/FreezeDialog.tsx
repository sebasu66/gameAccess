import { useEffect } from "react";
import AppDialog from "./AppDialog";
import type { FreezeLevel } from "./catalog/DigitalProcessManager";
import { freezeJob, freezeTitle, openFreezeConsole, startFreezeJob } from "./freezeJobs";
import { useI18n } from "./i18n";
import type { CatalogGame } from "./types";

export type FreezeMode = FreezeLevel | "thaw";

/** Confirm a freeze (either level) or a thaw of one game. Once confirmed, the work is a job of the app shown in the
 *  freeze console (FreezeConsole), which does not block the rest of the app; this dialog closes. Opened while that
 *  game is already being frozen, it only brings the console up on that job. */
export default function FreezeDialog({ game, mode, onClose }: { game: CatalogGame; mode: FreezeMode; onClose: () => void }) {
  const { t } = useI18n();
  const appId = game.app_id ?? game.id;
  const running = freezeJob(appId);
  useEffect(() => {
    if (!running) return;
    openFreezeConsole(appId);
    onClose();
  }, [running, appId, onClose]);
  if (running) return null;
  const copy = {
    freeze: { body: t("freezeBody"), confirm: t("freezeMenu") },
    deep: { body: t("deepFreezeBody"), confirm: t("deepFreezeMenu") },
    thaw: { body: t("thawBody"), confirm: t("thawMenu") },
  }[mode];
  return <AppDialog title={freezeTitle(mode, game.name)} message={copy.body} onClose={onClose}
    onConfirm={() => { startFreezeJob(game, mode); onClose(); }} confirmLabel={copy.confirm} cancelLabel={t("back")} initialAction="confirm" />;
}
