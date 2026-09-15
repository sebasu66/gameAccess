import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import BuildStamp from "./BuildStamp";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function WindowChrome() {
  const [fullscreen, setFullscreen] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    const refresh = () => { void appWindow.isMaximized().then(setMaximized); void appWindow.isFullscreen().then(setFullscreen); };
    refresh();
    const toggle = (event: KeyboardEvent) => {
      if (event.key !== "F11" || event.repeat) return;
      event.preventDefault();
      void appWindow.isFullscreen().then(value => appWindow.setFullscreen(!value)).then(refresh);
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, []);

  if (!isTauri()) return null;

  const appWindow = getCurrentWindow();
  const startDragging = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    await appWindow.startDragging();
  };
  const toggleMaximize = async () => {
    if (await appWindow.isFullscreen()) { await appWindow.setFullscreen(false); setFullscreen(false); }
    else await appWindow.toggleMaximize();
    setMaximized(await appWindow.isMaximized());
  };

  return (
    <div role="toolbar" aria-label="Controles de ventana" className="window-chrome" data-tauri-drag-region onDoubleClick={() => void toggleMaximize()}>
      <BuildStamp />
      <div className="window-drag-space" data-tauri-drag-region aria-hidden="true" onMouseDown={(event) => void startDragging(event)} />
      <div className="window-controls">
        <button type="button" aria-label="Minimizar" title="Minimizar" onDoubleClick={(event) => event.stopPropagation()} onClick={() => void appWindow.minimize()}><Minus size={15} /></button>
        <button type="button" aria-label={fullscreen ? "Salir de pantalla completa (F11)" : maximized ? "Restaurar" : "Maximizar"} title={fullscreen ? "Salir de pantalla completa (F11)" : maximized ? "Restaurar" : "Maximizar"} onDoubleClick={(event) => event.stopPropagation()} onClick={() => void toggleMaximize()}><Square size={12} /></button>
        <button type="button" className="window-close" aria-label="Cerrar" title="Cerrar" onDoubleClick={(event) => event.stopPropagation()} onClick={() => void appWindow.close()}><X size={16} /></button>
      </div>
    </div>
  );
}
