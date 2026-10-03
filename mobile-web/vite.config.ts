import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function standaloneBoundary(): Plugin {
  return {
    name: "yi-standalone-boundary",
    enforce: "pre",
    resolveId(source) {
      if (/^(?:node:|next(?:\/|$)|vinext(?:\/|$)|cloudflare:|@cloudflare\/|@openai\/sites-|react-server-dom-)/.test(source)) throw new Error(`Server-only dependency is forbidden in the standalone build: ${source}`);
      if (/(?:^|\/)(?:chatgpt-auth|worker\/index|db\/index|app\/layout|app\/page)(?:\.[cm]?[jt]sx?)?$/.test(source)) throw new Error(`Hosted entry is forbidden in the standalone build: ${source}`);
      return null;
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "fonts/OFL.txt", source: readFileSync(new URL("./fonts/OFL.txt", import.meta.url), "utf8") });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  publicDir: fileURLToPath(new URL("../public/", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-standalone/", import.meta.url)),
  base: "./",
  plugins: [standaloneBoundary(), react()],
  // Shared public VITE_FIREBASE_* values; never embed server/private credentials.
  envDir: fileURLToPath(new URL("../", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("../dist-mobile/", import.meta.url)),
    emptyOutDir: true,
    manifest: true,
    target: "es2022",
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    watch: process.env.CODEX_SANDBOX === "seatbelt" ? { useFsEvents: false, usePolling: true } : undefined,
  },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true },
});
