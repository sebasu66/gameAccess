import {useEffect} from "react";
import {listen} from "@tauri-apps/api/event";
import {ACTIVATION_INVALID_EVENT, invalidateActivation} from "./activation";
import {digitalDownloadService} from "./catalog/DigitalDownloadService";

export default function NativeAccessBoundary() {
  useEffect(() => {
    const suspend = () => { void digitalDownloadService.suspendForAccessEnd(); };
    window.addEventListener(ACTIVATION_INVALID_EVENT, suspend);
    let dispose: (()=>void) | undefined;
    let cancelled = false;
    if ("__TAURI_INTERNALS__" in window) {
      void listen("gameaccess:access-ended", () => invalidateActivation()).then(unlisten => {
        if (cancelled) unlisten(); else dispose = unlisten;
      });
    }
    return () => {cancelled=true; dispose?.(); window.removeEventListener(ACTIVATION_INVALID_EVENT,suspend);};
  },[]);
  return null;
}
