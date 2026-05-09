
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";

  // If we reloaded to recover from a stale-chunk error, clear the flag now
  // so future deployments can trigger another reload if needed.
  sessionStorage.removeItem('chunk-load-reload');

  createRoot(document.getElementById("root")!).render(<App />);
