import { listen } from "@tauri-apps/api/event";
import { translate } from "../i18n";
import { narrate } from "../narrationLog";
import { hasTauriRuntime } from "../native";
import { prepareCatalogCache } from "../catalogCache";
import { digitalCatalogService } from "../catalog/DigitalCatalog";
import { recordCatalogSyncTime } from "../catalogUpdates";
import { centralDialog, type StepRunner } from "./centralDialog";

type CatalogProgress = { stage: "seed" | "download" | "apply"; done: number; total: number };
type Report = Parameters<StepRunner["run"]>[0];

/** While `work` runs, the catalog progress Rust emits is shown on the step (bytes while downloading, games while applying). */
async function withCatalogProgress<T>(report: Report, work: () => Promise<T>): Promise<T> {
  const stop = hasTauriRuntime()
    ? await listen<CatalogProgress>("gameaccess:catalog-progress", ({ payload }) => {
      if (payload.stage === "download") report(payload.done, payload.total || undefined, translate("prepDownloading"), "bytes");
      else if (payload.stage === "apply") report(payload.done, payload.total || undefined, translate("prepApplying"), "items");
      else report(0, undefined, translate("prepInstallingDb"));
    }).catch(() => () => undefined)
    : () => undefined;
  try {
    return await work();
  } finally {
    stop();
  }
}

/** The database that ships with the app: installed on the first run, merged after an app update brings a newer one. */
export const localDatabaseStep = (): StepRunner => ({
  id: "catalog-local",
  label: translate("prepLocalDb"),
  run: report => withCatalogProgress(report, async () => {
    const result = await prepareCatalogCache();
    return result?.installed ? undefined : "skipped";
  }),
});

/** New and changed games since the database's revision. Without a connection the local database is used. */
export const catalogUpdatesStep = (outcome: { error?: unknown } = {}): StepRunner => ({
  id: "catalog-updates",
  label: translate("prepCatalogUpdates"),
  run: report => withCatalogProgress(report, async () => {
    try {
      const summary = await digitalCatalogService.loadCatalog({ requireRemote: true });
      recordCatalogSyncTime();
      return summary.updated ? undefined : "skipped";
    } catch (error) {
      // Not being able to look for news does not stop anyone from using the app with the database they have.
      outcome.error = error;
      report(0, undefined, translate("prepOffline"));
      void narrate(`Catalog updates unavailable; using the local database: ${String(error)}`, { area: "CATALOG", level: "WARN" });
      return "skipped";
    }
  }),
});

/** Startup: the local database first, then (when due) the news since its revision. The app waits for both. */
export async function runStartupPreparation(options: { checkUpdates: boolean; extraSteps?: StepRunner[] }): Promise<void> {
  const steps = [localDatabaseStep(), ...(options.checkUpdates ? [catalogUpdatesStep()] : []), ...(options.extraSteps ?? [])];
  await centralDialog.runTask(translate("prepTitle"), steps);
}

/** A later check (every 24 h or the refresh button): the dialog appears only if there is something to download.
 * Rejects when the catalog could not be reached, so a manual refresh can tell the player. */
export async function runCatalogUpdateTask(): Promise<void> {
  const outcome: { error?: unknown } = {};
  await centralDialog.runTask(translate("prepUpdateTitle"), [catalogUpdatesStep(outcome)]);
  if (outcome.error) throw outcome.error;
}
