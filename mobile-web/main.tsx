import { createRoot } from "react-dom/client";
import YiApp from "../app/YiApp";
import { configureRuntime } from "../src/platform/runtime";
import "../app/globals.css";
import "./standalone.css";

// This entry has no server markup to hydrate. Capture one render snapshot;
// the shared UI retains its existing Toronto calendar/timezone rules.
const initialNow = Date.now();
configureRuntime({ kind: "standalone-web", assetBase: new URL(import.meta.env.BASE_URL, document.baseURI).pathname });
const root = document.getElementById("root");
if (!root) throw new Error("Standalone application root is missing");
root.dataset.runtime = "standalone-web";
createRoot(root).render(<YiApp initialNow={initialNow} />);
