import { useEffect, useSyncExternalStore } from "react";
import { useI18n } from "./i18n";
import { getPluginStatuses, subscribePluginStatuses, monitorPluginRuntime } from "./catalog/PluginRuntime";

export function PluginIndicator() {
  const { locale } = useI18n();
  const plugins = useSyncExternalStore(subscribePluginStatuses, getPluginStatuses, getPluginStatuses);
  useEffect(() => monitorPluginRuntime(), []);

  if (plugins.length === 0) return null;

  return <div className="plugin-indicator-group" role="status" aria-live="polite">
    {plugins.slice(0, 3).map(p => <span key={p.id} className="plugin-indicator-item" data-connected={p.alive}
      title={`Download sources plugin (${p.name}) · ` +(p.alive ? (locale === "es" ? "Conectado" : "Connected") : (locale === "es" ? "Desconectado" : "Disconnected"))}>
      <i aria-hidden="true" /><span>Download sources plugin</span>
    </span>)}
    {plugins.length > 3 && <span>+{plugins.length - 3}</span>}
  </div>;
}
