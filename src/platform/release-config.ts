type ToolWindow = Window & { __EQUANIMITY_DEVELOPMENT_TOOLS__?: boolean };

/** Native Debug injects this before bundled production-mode web assets load.
 * Release never injects it. No persisted preference can enable these tools. */
export function developmentToolsEnabled() {
  return import.meta.env?.DEV === true || (typeof window !== "undefined"
    && (window as ToolWindow).__EQUANIMITY_DEVELOPMENT_TOOLS__ === true);
}

export function privacyPolicyConfiguration(value = import.meta.env?.VITE_PRIVACY_POLICY_URL) {
  if (!value?.trim()) return { state: "missing" as const, url: null };
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost"
      || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")
      || url.hostname === "127.0.0.1" || url.hostname === "[::1]") throw new Error("Not a public HTTPS policy");
    return { state: "configured" as const, url: url.href };
  } catch { return { state: "invalid" as const, url: null }; }
}
