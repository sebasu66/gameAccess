import { useEffect, useSyncExternalStore } from "react";
import { useI18n } from "./i18n";
import { getPluginStatuses, subscribePluginStatuses, monitorPluginRuntime } from "./catalog/PluginRuntime";
import { openPluginSection } from "./pluginNav";

/**
 * The installed plugins, in the top right corner of the screen (not the frame: plugins are third-party and there can be
 * several, Seba 2026-11-05): one column, each with its status light. A plugin that is off is grey. A click opens its
 * section in Settings › Plugins.
 */
export function PluginIndicator() {
  const { t } = useI18n();
  const plugins = useSyncExternalStore(subscribePluginStatuses, getPluginStatuses, getPluginStatuses);
  useEffect(() => monitorPluginRuntime(), []);
  if (plugins.length === 0) return null;
  return <div className="plugin-indicator-group" role="status" aria-live="polite">
    {plugins.map(plugin => {
      const state = plugin.enabled === false ? "pluginStateOff" : plugin.alive ? "pluginStateConnected" : "pluginStateDisconnected";
      return <button key={plugin.id} type="button" className="plugin-indicator-item" data-connected={plugin.alive} data-off={plugin.enabled === false || undefined}
        title={t("pluginIndicatorTip", { title: t("pluginIndicatorName"), name: plugin.name, state: t(state) })} onClick={() => openPluginSection(plugin.id)}>
        <i aria-hidden="true" /><span>{plugin.name}</span>
      </button>;
    })}
  </div>;
}
