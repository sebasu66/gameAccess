import { useEffect, useState } from "react";

import { getBackendConnection, type BackendConnectionKind } from "./settings";

declare const __BUILD_TIMESTAMP__: string;

type BackendDisplayKind = BackendConnectionKind | "starting";

export function backendConnectionLabel(kind: BackendDisplayKind) {
  if (kind === "local") return "Servidor: Local";
  if (kind === "remote") return "Servidor: Remoto";
  if (kind === "offline") return "Servidor: Sin conexión";
  return "Servidor: Iniciando servidor remoto…";
}

export default function BuildStamp() {
  const timestamp = typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "desarrollo";
  const [backendKind, setBackendKind] = useState<BackendDisplayKind>("starting");

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const refresh = async (forceRefresh: boolean) => {
      const connection = await getBackendConnection(forceRefresh);
      if (!cancelled) setBackendKind(connection.kind);
    };

    void refresh(false).then(() => {
      if (cancelled) return;
      timer = window.setInterval(() => void refresh(true), 5000);
    });

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
    };
  }, []);

  const status = backendConnectionLabel(backendKind);
  const statusColor = backendKind === "offline" ? "#fca5a5" : backendKind === "local" ? "#86efac" : "#cbd5e1";

  return (
    <small
      title={`Hora de compilación (UTC) · ${status}`}
      style={{ alignSelf: "center", color: "#cbd5e1", padding: "0 12px", whiteSpace: "nowrap", fontSize: 11, display: "inline-flex", gap: 9 }}
    >
      <span>Compilación: {timestamp}</span>
      <span style={{ color: statusColor, display: "inline-flex", alignItems: "center", gap: 5 }}>
        {backendKind === "starting" ? <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <g>
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity=".22" />
            <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite" />
          </g>
        </svg> : null}
        {status}
      </span>
    </small>
  );
}
