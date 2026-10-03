export type FirebaseConfiguration = {
  enabled: boolean;
  options: { apiKey: string; authDomain: string; projectId: string; appId: string };
  emulators: boolean;
};

export function readFirebaseConfiguration(env: Record<string, string | undefined>): FirebaseConfiguration {
  const options = { apiKey: env.VITE_FIREBASE_API_KEY ?? "", authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "", projectId: env.VITE_FIREBASE_PROJECT_ID ?? "", appId: env.VITE_FIREBASE_APP_ID ?? "" };
  const enabled = env.VITE_FIREBASE_ENABLED === "true";
  const emulators = env.VITE_FIREBASE_USE_EMULATORS === "true";
  if (enabled && Object.values(options).some(value => !value.trim() || value.includes("REPLACE_"))) throw new Error("Firebase configuration is incomplete; local mode is still available");
  if (enabled && emulators && !options.projectId.startsWith("demo-")) throw new Error("Emulator mode requires a demo- project ID to prevent production access");
  return { enabled, options, emulators };
}

// Only explicitly named public web config is read. Never read credentials/keys.
export function browserFirebaseConfiguration() {
  return readFirebaseConfiguration(import.meta.env ?? {});
}
