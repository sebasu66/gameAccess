import { translate } from "../i18n";
import { narrate } from "../narrationLog";
import { checkPluginSources } from "../catalog/PluginSources";
import { getPluginStatuses, pollPluginRuntime } from "../catalog/PluginRuntime";
import { centralDialog, type StepRunner } from "./centralDialog";

const WAIT_FOR_PLUGIN_MS = 30_000;
/** The last failure the player was shown; an automatic sync that fails the same way again does not interrupt twice. */
let shownFailure = "";

function sourcePluginAlive(): boolean {
  return getPluginStatuses().some(plugin => plugin.type === "source_provider" && plugin.alive);
}

/** A plugin that was just installed needs a few seconds to start: wait for it (up to 30 s) before syncing. */
async function waitForPlugin(report: Parameters<StepRunner["run"]>[0]): Promise<boolean> {
  const started = Date.now();
  report(0, undefined, translate("pluginStarting"));
  while (Date.now() - started < WAIT_FOR_PLUGIN_MS) {
    await pollPluginRuntime().catch(() => undefined);
    if (sourcePluginAlive()) return true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

export const pluginSourcesStep = (options: { waitForPlugin?: boolean } = {}): StepRunner => {
  let retrying = false;
  return {
    id: "plugin-sources",
    label: translate("pluginStep"),
    run: async report => {
      if (options.waitForPlugin && !(await waitForPlugin(report))) throw new Error(translate("pluginNotAnswering"));
      if (!sourcePluginAlive()) return "skipped";
      try {
        await checkPluginSources(undefined, (detail, done, total) => report(done ?? 0, total || undefined, detail, "items"));
        shownFailure = "";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // After an install or a retry the player is always told; a background sync repeats a known failure only in the log.
        if (!options.waitForPlugin && !retrying && message === shownFailure) {
          void narrate(`Plugin sources still not synced: ${message}`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
          return "skipped";
        }
        shownFailure = message;
        retrying = true;
        throw error;
      }
    },
  };
};

/**
 * The download plugin's sources, in the central dialog (it appears only when the sync takes a while, as with a
 * plugin's first full index, or when it fails, with the option to try again). After an install the plugin is
 * started and synced right away: no restart needed.
 */
export async function runPluginSourcesTask(options: { waitForPlugin?: boolean } = {}): Promise<void> {
  await centralDialog.runTask(translate(options.waitForPlugin ? "pluginInstalledTitle" : "pluginTaskTitle"), [pluginSourcesStep(options)], { canRetry: true });
}
