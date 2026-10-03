import { ConvexProvider, ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App";

const ingesteld = import.meta.env.VITE_CONVEX_URL as string | undefined;
// In ontwikkeling draait Convex lokaal en loopt het via de Vite-server (zie vite.config.ts).
// Open je de pagina vanaf een ander toestel, dan wijst de client naar de eigen herkomst
// in plaats van naar 127.0.0.1 van dat toestel.
const lokaal = (h: string) => h === "localhost" || h === "127.0.0.1";
const url = import.meta.env.DEV && ingesteld && lokaal(new URL(ingesteld).hostname) && !lokaal(location.hostname)
  ? location.origin
  : ingesteld;

if (!url) {
  document.getElementById("root")!.innerHTML =
    '<div style="padding:24px;font-family:Georgia,serif;color:#efe3c6;background:#1a120b;min-height:100vh">' +
    "<h1>VITE_CONVEX_URL ontbreekt</h1><p>Start <code>bun run dev</code> (dan zet Convex hem in .env.local) of zie de README.</p></div>";
} else {
  const convex = new ConvexReactClient(url);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    </StrictMode>,
  );
}
