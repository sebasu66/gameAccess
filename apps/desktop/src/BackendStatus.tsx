import { useEffect, useState } from "react";
import { getBackendConnection, type BackendConnectionKind } from "./settings";
import { useI18n } from "./i18n";
export function backendStatusPresentation(kind: BackendConnectionKind | null, locale: "es" | "en") {
 return { connected: kind === "local" || kind === "remote", label: kind === "local" ? "Local" : kind === "remote" ? (locale === "es" ? "Conectado" : "Connected") : (locale === "es" ? "Desconectado" : "Disconnected") };
}
export default function BackendStatus() {
 const { locale } = useI18n();
 const [kind,setKind] = useState<BackendConnectionKind | null>(null);
 useEffect(() => {
  let cancelled = false; let timer: number | undefined;
  const refresh = async (force = false) => {
   try { const result = await getBackendConnection(force); if (!cancelled) setKind(result.kind); }
   catch { if (!cancelled) setKind("offline"); }
   finally { if (!cancelled) timer = window.setTimeout(() => void refresh(true),5000); }
  };
  void refresh();
  return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); };
 }, []);
 const status = backendStatusPresentation(kind,locale);
 return <span className="ga-backend-status" data-connection={kind ?? "checking"} data-connected={status.connected} role="status" aria-live="polite"><i aria-hidden="true" /><span>{status.label}</span></span>;
}
