import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "win.calemandersonbar.equanimity",
  appName: "Equanimity",
  webDir: "dist-mobile",
  server: {
    // A WKWebView scheme-handler origin, not a DNS host or development server.
    hostname: "equanimity.local",
    iosScheme: "capacitor",
  },
};

export default config;
