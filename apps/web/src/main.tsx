import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { OfflineBanner } from "./components/OfflineBanner";
import { MeProvider } from "./lib/me";
import { registerServiceWorker } from "./lib/offline";

registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeProvider>
      <OfflineBanner />
      <App />
    </MeProvider>
  </StrictMode>,
);
