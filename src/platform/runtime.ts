export type RuntimeKind = "hosted-web" | "standalone-web" | "native-shell";
export type AppRuntime = { kind: RuntimeKind; assetBase: string };

// Hosted SSR keeps its original origin-root URLs. A future shell must opt in;
// no SDK, identity inference, native detection, or storage changes happen here.
let runtime: AppRuntime = { kind: "hosted-web", assetBase: "/" };
export function configureRuntime(next: AppRuntime) {
  if (!next.assetBase.startsWith("/") || next.assetBase.startsWith("//") || next.assetBase.includes("..") || /[?#]/.test(next.assetBase)) throw new Error("Asset base must be a local absolute directory path");
  runtime = { ...next, assetBase: next.assetBase.endsWith("/") ? next.assetBase : `${next.assetBase}/` };
}
export function getRuntime(): Readonly<AppRuntime> { return { ...runtime }; }
export function assetUrl(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Application assets must be origin-local paths");
  return `${runtime.assetBase}${path.slice(1)}`;
}
