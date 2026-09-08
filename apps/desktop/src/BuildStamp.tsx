import { useEffect, useState } from "react";

import { getBackendConnection, type BackendConnectionKind } from "./settings";

declare const __BUILD_TIMESTAMP__: string;

export function backendConnectionLabel(kind: BackendConnectionKind | "checking") {
  if (kind === "local") return "Server: Local";
  if (kind === "remote") return "Server: Remote";
  if (kind === "offline") return "Server: Offline";
  return "Server: Checking…";
}

export default function BuildStamp() {
  const timestamp = typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "development";
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
      title={`Compilation time (UTC) · ${status}`}
      style={{ alignSelf: "center", color: "#cbd5e1", padding: "0 12px", whiteSpace: "nowrap", fontSize: 11, display: "inline-flex", gap: 9 }}
    >
      <span>Build: {timestamp}</span>
      <span style={{ color: statusColor }}>{status}</span>
    </small>
  );
}
