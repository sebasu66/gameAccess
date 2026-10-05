import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import BuildStamp from "./BuildStamp";
import LanguageSwitch from "./LanguageSwitch";
import { useI18n } from "./i18n";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function WindowChrome() {
  const [maximized, setMaximized] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    void appWindow.isMaximized().then(setMaximized);
  }, []);

  if (!isTauri()) return null;

  const appWindow = getCurrentWindow();
  const startDragging = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    await appWindow.startDragging();
  };
  const toggleMaximize = async () => {
    await appWindow.toggleMaximize();
    setMaximized(await appWindow.isMaximized());
  };

  const maximizeLabel = maximized ? t("restore") : t("maximize");
  return (
    <div role="toolbar" aria-label={t("windowControls")} className="window-chrome" data-tauri-drag-region onDoubleClick={() => void toggleMaximize()}>
      <BuildStamp />
      <div className="window-drag-space" data-tauri-drag-region aria-hidden="true" onMouseDown={(event) => void startDragging(event)} />
      <LanguageSwitch />
      <div className="window-controls">
        <button type="button" aria-label={t("minimize")} title={t("minimize")} onDoubleClick={(event) => event.stopPropagation()} onClick={() => void appWindow.minimize()}><Minus size={15} /></button>
        <button type="button" aria-label={maximizeLabel} title={maximizeLabel} onDoubleClick={(event) => event.stopPropagation()} onClick={() => void toggleMaximize()}><Square size={12} /></button>
        <button type="button" className="window-close" aria-label={t("close")} title={t("close")} onDoubleClick={(event) => event.stopPropagation()} onClick={() => void appWindow.close()}><X size={16} /></button>
      </div>
    </div>
  );
}
