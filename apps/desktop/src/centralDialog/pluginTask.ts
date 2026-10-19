import { translate } from "../i18n";
import { checkPluginSources } from "../catalog/PluginSources";
import { getPluginStatuses, pollPluginRuntime } from "../catalog/PluginRuntime";
import { centralDialog, type StepRunner } from "./centralDialog";

const WAIT_FOR_PLUGIN_MS = 30_000;

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

export const pluginSourcesStep = (options: { waitForPlugin?: boolean } = {}): StepRunner => ({
  id: "plugin-sources",
  label: translate("pluginStep"),
  run: async report => {
    if (options.waitForPlugin && !(await waitForPlugin(report))) throw new Error(translate("pluginNotAnswering"));
    if (!sourcePluginAlive()) return "skipped";
    await checkPluginSources(undefined, (detail, done, total) => report(done ?? 0, total || undefined, detail, "items"));
  },
});

/**
 * The download plugin's sources, in the central dialog (it appears only when the sync takes a while, as with a
 * plugin's first full index). After an install the plugin is started and synced right away: no restart needed.
 */
export async function runPluginSourcesTask(options: { waitForPlugin?: boolean } = {}): Promise<void> {
  await centralDialog.runTask(translate(options.waitForPlugin ? "pluginInstalledTitle" : "pluginTaskTitle"), [pluginSourcesStep(options)]);
}
