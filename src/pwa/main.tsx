import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@openuidev/react-ui/styles/index.css";
import "./styles.css";

document.documentElement.dataset.pfhBuildId = __PFH_BUILD_ID__;
if (__PFH_BUILD_SHA__)
  document.documentElement.dataset.pfhBuildSha = __PFH_BUILD_SHA__;

const ephemeralTunnel = window.location.hostname.endsWith(".ngrok-free.app");

if ("serviceWorker" in navigator && import.meta.env.PROD && !ephemeralTunnel) {
  window.addEventListener(
    "load",
    () => void navigator.serviceWorker.register("/sw.js"),
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
