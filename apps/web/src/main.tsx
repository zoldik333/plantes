import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { MeProvider } from "./lib/me";

// Le service worker ne gère que la réception des notifications push (pas de cache hors ligne pour l'instant).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => console.error("service worker", err));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeProvider>
      <App />
    </MeProvider>
  </StrictMode>,
);
