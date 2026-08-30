import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import WindowChrome from "./WindowChrome";
import "./styles.css";
import "./session.css";
import "./experience.css";
import "./polish.css";
import "./library-room.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WindowChrome />
    <App />
  </React.StrictMode>,
);
