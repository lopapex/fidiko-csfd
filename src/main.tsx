import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";

// Posters fade in once decoded instead of popping in (see .poster img rules in animations.css).
document.addEventListener(
  "load",
  event => {
    if (event.target instanceof HTMLImageElement) event.target.dataset.loaded = "1";
  },
  true,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__BUILD_ID__)}`);
  });
}

