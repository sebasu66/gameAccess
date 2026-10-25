import { useEffect, useSyncExternalStore } from "react";
import { useI18n } from "./i18n";
import { getPluginStatuses, subscribePluginStatuses, monitorPluginRuntime } from "./catalog/PluginRuntime";

export function PluginIndicator() {
  const { t } = useI18n();
  const plugins = useSyncExternalStore(subscribePluginStatuses, getPluginStatuses, getPluginStatuses);
  useEffect(() => monitorPluginRuntime(), []);

  // Only with a plugin installed: without one the footer shows nothing about plugins.
  if (plugins.length === 0) return null;

  return <div className="plugin-indicator-group" role="status" aria-live="polite">
    {plugins.slice(0, 3).map(p => <span key={p.id} className="plugin-indicator-item" data-connected={p.alive}
      title={t("pluginIndicatorTip", { title: t("pluginIndicatorName"), name: p.name, state: t(p.alive ? "pluginStateConnected" : "pluginStateDisconnected") })}>
      <i aria-hidden="true" /><span>{t("pluginIndicatorName")}</span>
    </span>)}
    {plugins.length > 3 && <span>+{plugins.length - 3}</span>}
  </div>;
}
