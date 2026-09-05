import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import BuildStamp from "./BuildStamp";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function WindowChrome() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    void appWindow.isMaximized().then(setMaximized).catch(() => undefined);
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

  return (
    <div className="window-chrome" data-tauri-drag-region onDoubleClick={() => void toggleMaximize()}>
      <BuildStamp />
      <div className="window-drag-space" data-tauri-drag-region aria-hidden="true" onMouseDown={(event) => void startDragging(event)} />
      <div className="window-controls">
        <button aria-label="Minimizar" title="Minimizar" onDoubleClick={(event) => event.stopPropagation()} onClick={() => void appWindow.minimize()}><Minus size={15} /></button>
        <button aria-label={maximized ? "Restaurar" : "Maximizar"} title={maximized ? "Restaurar" : "Maximizar"} onDoubleClick={(event) => event.stopPropagation()} onClick={() => void toggleMaximize()}><Square size={12} /></button>
        <button className="window-close" aria-label="Cerrar" title="Cerrar" onDoubleClick={(event) => event.stopPropagation()} onClick={() => void appWindow.close()}><X size={16} /></button>
      </div>
    </div>
  );
}
