import { createCloudSession } from "../services/cloud-session";
import { browserFirebaseConfiguration } from "../adapters/firebase/config";
import { lifecycleLog, lifecycleSpan } from "../platform/lifecycle-log";

let cloudPrimary = false;
try { cloudPrimary = browserFirebaseConfiguration().enabled; } catch { cloudPrimary = true; /* enabled but invalid configuration stays closed; fallback must be explicit */ }

lifecycleLog("app launch");
export const cloudSession = createCloudSession(async () => {
  const config = browserFirebaseConfiguration();
  if (!config.enabled) throw new Error("Cloud configuration is disabled");
  const finish = lifecycleSpan("Firebase SDK import");
  let client;
  try { client = await import("../adapters/firebase/client"); } finally { finish(); }
  const { connectFirebase } = client;
  return connectFirebase(config);
}, { cloudPrimary, restoreOnStart: cloudPrimary && typeof window !== "undefined" });
