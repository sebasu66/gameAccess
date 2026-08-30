import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import RuntimeGate from "./RuntimeGate";
import WindowChrome from "./WindowChrome";
import "./styles.css";
import "./session.css";
import "./experience.css";
import "./polish.css";
import "./library-room.css";
import "./bootstrap.css";

class AppCrashBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error("gameAccess UI crash", error, info); }
  render() {
    if (this.state.error) return <main className="runtime-gate"><section className="runtime-gate-card crash-card"><span className="eyebrow">RECUPERACIÓN DE INTERFAZ</span><h1>GameAccess encontró un error, pero el runtime sigue funcionando.</h1><p>{this.state.error.message || "Error inesperado de interfaz."}</p><button className="primary" onClick={() => window.location.reload()}>Reintentar</button></section></main>;
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WindowChrome />
    <AppCrashBoundary><RuntimeGate><App /></RuntimeGate></AppCrashBoundary>
  </React.StrictMode>,
);
