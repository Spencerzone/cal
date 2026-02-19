import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

try {
  // your existing createRoot(...).render(<App />)
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
} catch (e) {
  console.error("BOOT ERROR:", e);
  document.body.innerHTML =
    `<pre style="white-space:pre-wrap;padding:12px">BOOT ERROR:\n${String(e)}</pre>`;
  throw e;
}