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

async function nukePwaCachesIfRequested() {
  const url = new URL(window.location.href);

  // Visit /cal/?nuke=1 once
  if (url.searchParams.get("nuke") !== "1") return;

  try {
    // Unregister any service workers
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }

    // Delete all Cache Storage entries (Workbox precache etc.)
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }

    // Clear local/session storage (optional but helps)
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}

    // Reload without the nuke param
    url.searchParams.delete("nuke");
    window.location.replace(url.toString());
  } catch (e) {
    console.error("NUKE FAILED", e);
  }
}

// call it before React mounts
await nukePwaCachesIfRequested();


(async () => {
  await nukePwaCachesIfRequested();
  // ReactDOM.createRoot(...).render(...)
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
})();