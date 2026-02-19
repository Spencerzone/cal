import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

function show(label: string, payload: any) {
  console.error(label, payload);

  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.padding = "12px";
  pre.style.margin = "0";
  pre.style.fontFamily =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

  pre.textContent =
    `${label}\n\n` +
    (typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));

  document.body.innerHTML = "";
  document.body.appendChild(pre);
}

window.addEventListener("error", (e) => {
  const any = e as any;

  // Firefox often hides .error; so print the rest
  show("WINDOW ERROR", {
    message: any.message ?? null,
    filename: any.filename ?? null,
    lineno: any.lineno ?? null,
    colno: any.colno ?? null,
    type: any.type ?? null,
    targetTag: (any.target && (any.target as any).tagName) || null,
    targetSrc: (any.target && ((any.target as any).src || (any.target as any).href)) || null,
    errorString: any.error ? String(any.error) : null,
    stack: any.error?.stack ?? null,
  });
});

window.addEventListener("unhandledrejection", (e) => {
  const any = e as any;
  show("UNHANDLED REJECTION", {
    reasonType: typeof any.reason,
    reasonString: any.reason ? String(any.reason) : null,
    reason: any.reason ?? null,
    stack: any.reason?.stack ?? null,
  });
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);