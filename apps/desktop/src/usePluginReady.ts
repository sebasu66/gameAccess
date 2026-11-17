import { useEffect, useState } from "react";
import { PLUGINS_CHANGED_EVENT } from "./catalog/PluginRuntime";
import { SOURCES_CHANGED_EVENT, sourcePluginReady } from "./catalog/PluginSources";

/** Whether a download-sources plugin is installed and synced (null while it is being checked). */
export function usePluginReady(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () => void sourcePluginReady().then(value => { if (alive) setReady(value); });
    check();
    window.addEventListener(PLUGINS_CHANGED_EVENT, check);
    window.addEventListener(SOURCES_CHANGED_EVENT, check);
    return () => { alive = false; window.removeEventListener(PLUGINS_CHANGED_EVENT, check); window.removeEventListener(SOURCES_CHANGED_EVENT, check); };
  }, []);
  return ready;
}
