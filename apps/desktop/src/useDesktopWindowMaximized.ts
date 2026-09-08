import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useDesktopWindowMaximized() {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  useEffect(() => {

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const apply = (value: boolean) => { if (!cancelled) setIsWindowMaximized(value); };

    if ("__TAURI_INTERNALS__" in window) {
      const appWindow = getCurrentWindow();
      const refresh = () => { void appWindow.isMaximized().then(apply).catch(() => undefined); };
      refresh();
      void appWindow.onResized(() => refresh()).then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      }).catch(() => undefined);
    } else {
      const refresh = () => apply(window.innerWidth >= 1500 && window.innerWidth / Math.max(1, window.innerHeight) >= 1.45);
      refresh();
      window.addEventListener("resize", refresh);
      unlisten = () => window.removeEventListener("resize", refresh);
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return isWindowMaximized;
}
