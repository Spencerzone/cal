import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// Show real runtime error even when it happens in async handlers
function showBootError(label: string, err: any) {
  const msg =
    err?.message ||
    (typeof err === "string" ? err : "") ||
    JSON.stringify(err, null, 2);

  console.error(label, err);

  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.padding = "12px";
  pre.style.margin = "0";
  pre.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  pre.textContent = `${label}\n\n${msg}\n\n${err?.stack || ""}`;

  document.body.innerHTML = "";
  document.body.appendChild(pre);
}

window.addEventListener("error", (e) => {
  showBootError("WINDOW ERROR:", (e as any).error || e);
});

window.addEventListener("unhandledrejection", (e) => {
  showBootError("UNHANDLED REJECTION:", (e as any).reason || e);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);