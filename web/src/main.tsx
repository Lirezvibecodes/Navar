import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Keeps the app itself on the phone so it opens when the server does not
// answer (see public/sw.js). Production only: in dev it would serve stale
// bundles over Vite's own reloading. Telegram on iOS has no service workers,
// and there this is simply skipped.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
