import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "./i18n";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function WindowChrome() {
  const [maximized, setMaximized] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    // Kept up to date: the window also changes size from the keyboard, the taskbar, or when a game ends.
    let stop: (() => void) | undefined, live = true;
    const refresh = () => void appWindow.isMaximized().then(value => { if (live) setMaximized(value); }).catch(() => undefined);
    refresh();
    void appWindow.onResized(refresh).then(dispose => { if (live) stop = dispose; else dispose(); }).catch(() => undefined);
    return () => { live = false; stop?.(); };
  }, []);

  if (!isTauri()) return null;

  const appWindow = getCurrentWindow();
  const startDragging = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    await appWindow.startDragging();
  };
  // Native (window_fit.rs): a window left small by a game that changed the resolution is maximized properly, instead
  // of being "restored" by the first click.
  const toggleMaximize = async () => {
    setMaximized(await invoke<boolean>("window_toggle_maximize").catch(async () => { await appWindow.toggleMaximize(); return appWindow.isMaximized(); }));
  };

  const maximizeLabel = maximized ? t("restore") : t("maximize");
  return (
    <div role="toolbar" aria-label={t("windowControls")} className="window-chrome" data-tauri-drag-region onDoubleClick={() => void toggleMaximize()}>
      <div className="window-drag-space" data-tauri-drag-region aria-hidden="true" onMouseDown={(event) => void startDragging(event)} />
      <div className="window-controls">
        <button type="button" aria-label={t("minimize")} title={t("minimize")} onDoubleClick={(event) => event.stopPropagation()} onClick={() => void appWindow.minimize()}><Minus size={15} /></button>
        <button type="button" aria-label={maximizeLabel} title={maximizeLabel} onDoubleClick={(event) => event.stopPropagation()} onClick={() => void toggleMaximize()}><Square size={12} /></button>
        <button type="button" className="window-close" aria-label={t("close")} title={t("close")} onDoubleClick={(event) => event.stopPropagation()} onClick={() => void appWindow.close()}><X size={16} /></button>
      </div>
    </div>
  );
}
