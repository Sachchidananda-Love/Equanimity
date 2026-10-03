import { createCloudSession } from "../services/cloud-session";
import { browserFirebaseConfiguration } from "../adapters/firebase/config";

let cloudPrimary = false;
try { cloudPrimary = browserFirebaseConfiguration().enabled; } catch { cloudPrimary = true; /* enabled but invalid configuration stays closed; fallback must be explicit */ }

export const cloudSession = createCloudSession(async () => {
  const config = browserFirebaseConfiguration();
  if (!config.enabled) throw new Error("Cloud configuration is disabled");
  const { connectFirebase } = await import("../adapters/firebase/client");
  return connectFirebase(config);
}, { cloudPrimary });
