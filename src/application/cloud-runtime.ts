import { createCloudSession } from "../services/cloud-session";
import { browserFirebaseConfiguration } from "../adapters/firebase/config";
import { lifecycleLog, lifecycleSpan } from "../platform/lifecycle-log";
import { createDeviceCloudRecovery } from "../adapters/firebase/device-recovery";

let cloudPrimary = false;
let recovery: ReturnType<typeof createDeviceCloudRecovery> | undefined;
try {
  const configuration = browserFirebaseConfiguration();
  cloudPrimary = configuration.enabled;
  if (cloudPrimary && typeof window !== "undefined") recovery = createDeviceCloudRecovery(configuration.options.projectId, configuration.options.appId);
} catch { cloudPrimary = true; /* enabled but invalid configuration stays closed; fallback must be explicit */ }

lifecycleLog("app launch");
export const cloudSession = createCloudSession(async () => {
  const config = browserFirebaseConfiguration();
  if (!config.enabled) throw new Error("Cloud configuration is disabled");
  const finish = lifecycleSpan("Firebase SDK import");
  let client;
  try { client = await import("../adapters/firebase/client"); } finally { finish(); }
  const { connectFirebase } = client;
  return connectFirebase(config, recovery);
}, { cloudPrimary, recovery, initialOnline: typeof window === "undefined" || window.navigator.onLine, restoreOnStart: cloudPrimary && typeof window !== "undefined" });
