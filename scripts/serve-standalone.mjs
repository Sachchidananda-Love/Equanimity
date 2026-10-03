import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".wav": "audio/wav", ".mov": "video/quicktime", ".mp4": "video/mp4", ".woff2": "font/woff2" };

/** Plain disk-file server: no Workers, framework, SSR, auth, or SPA fallback. */
export function createStandaloneServer({ directory = fileURLToPath(new URL("../dist-mobile/", import.meta.url)), basePath = "/" } = {}) {
  const root = resolve(directory);
  return createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, "http://static.invalid").pathname);
      if (!pathname.startsWith(basePath)) { response.writeHead(404).end(); return; }
      const relative = pathname.slice(basePath.length);
      const filename = resolve(root, relative || "index.html");
      if (!filename.startsWith(`${root}${sep}`)) { response.writeHead(404).end(); return; }
      const info = await stat(filename);
      if (!info.isFile()) { response.writeHead(404).end(); return; }
      let start = 0; let end = info.size - 1; let status = 200;
      const range = request.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) { response.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end(); return; }
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(info.size - 1, Number(match[2])) : info.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < 0 || start >= info.size) { response.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end(); return; }
        status = 206;
      }
      response.writeHead(status, { "Content-Type": types[extname(filename)] ?? "application/octet-stream", "Content-Length": Math.max(0, end - start + 1), "Accept-Ranges": "bytes", "Cache-Control": "no-cache", ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}) });
      if (request.method === "HEAD" || info.size === 0) response.end();
      else createReadStream(filename, { start, end }).on("error", () => response.destroy()).pipe(response);
    } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 4174);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be an integer between 1 and 65535");
  const server = createStandaloneServer();
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`Standalone files: http://127.0.0.1:${port}/ (dist-mobile)`));
}
