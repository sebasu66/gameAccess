import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CatalogTabs from "./CatalogTabs";
import RuntimeGate from "./RuntimeGate";
import SteamSessionSettings from "./SteamSessionSettings";
import WindowChrome from "./WindowChrome";
import { getCatalogMode, setCatalogMode, type CatalogMode } from "./catalogMode";
import "./styles.css";
import "./session.css";
import "./experience.css";
import "./polish.css";
import "./library-room.css";
import "./download-manager.css";
import "./bootstrap.css";
import "./steam-session-settings.css";
import "./catalog-tabs.css";

class AppCrashBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error("gameAccess UI crash", error, info); }
  render() {
    if (this.state.error) return <main className="runtime-gate"><section className="runtime-gate-card crash-card"><span className="eyebrow">RECUPERACIÓN DE INTERFAZ</span><h1>GameAccess encontró un error, pero el runtime sigue funcionando.</h1><p>{this.state.error.message || "Error inesperado de interfaz."}</p><button type="button" className="primary" onClick={() => window.location.reload()}>Reintentar</button></section></main>;
    return this.props.children;
  }
}

function CatalogShell() {
  const [mode, setMode] = React.useState<CatalogMode>(() => getCatalogMode());
  const changeMode = (next: CatalogMode) => {
    setCatalogMode(next);
    setMode(next);
  };
  return <><CatalogTabs mode={mode} onChange={changeMode} /><App key={mode} /></>;
}

const root = document.getElementById("root");
if (!root) throw new Error("gameAccess root element is missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <WindowChrome />
    <AppCrashBoundary><RuntimeGate><CatalogShell /><SteamSessionSettings /></RuntimeGate></AppCrashBoundary>
  </React.StrictMode>,
);
