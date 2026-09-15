import { useEffect, useState } from "react";

import { getBackendConnection, type BackendConnectionKind } from "./settings";

declare const __BUILD_TIMESTAMP__: string;

export function backendConnectionLabel(kind: BackendConnectionKind | "checking") {
  if (kind === "local") return "Servidor: Local";
  if (kind === "remote") return "Servidor: Remoto";
  if (kind === "offline") return "Servidor: Sin conexión";
  return "Servidor: Comprobando…";
}

export default function BuildStamp() {
  const timestamp = typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "desarrollo";
  const [backendKind, setBackendKind] = useState<BackendConnectionKind | "checking">("checking");

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const connection = await getBackendConnection(true);
      if (!cancelled) setBackendKind(connection.kind);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
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
      <span style={{ color: statusColor }}>{status}</span>
    </small>
  );
}
