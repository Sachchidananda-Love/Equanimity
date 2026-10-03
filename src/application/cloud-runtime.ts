import { createCloudSession } from "../services/cloud-session";
import { browserFirebaseConfiguration } from "../adapters/firebase/config";

export const cloudSession = createCloudSession(async () => {
  const config = browserFirebaseConfiguration();
  if (!config.enabled) throw new Error("Cloud configuration is disabled");
  const { connectFirebase } = await import("../adapters/firebase/client");
  return connectFirebase(config);
});
