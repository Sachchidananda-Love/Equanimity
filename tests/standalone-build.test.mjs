import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { once } from "node:events";
import { createHash } from "node:crypto";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "vite";
import YiApp from "../app/YiApp.tsx";
import { assetUrl, configureRuntime, getRuntime } from "../src/platform/runtime.ts";
import { createStandaloneServer } from "../scripts/serve-standalone.mjs";

const output = new URL("../dist-mobile/", import.meta.url);
const config = new URL("../mobile-web/vite.config.ts", import.meta.url).pathname;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const read = path => readFile(new URL(path, output));
async function withServer(basePath, check) {
  const server = createStandaloneServer({ basePath });
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  try { await check(`http://127.0.0.1:${server.address().port}${basePath}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test("standalone HTML owns its client entry, snapshot, viewport and local font CSS", async () => {
  const html=(await read("index.html")).toString();
  assert.match(html,/<div id="root"><\/div>/);assert.match(html,/viewport-fit=cover/);
  assert.match(html,/src="\.\/assets\/[^"]+\.js"/);assert.match(html,/href="\.\/assets\/[^"]+\.css"/);
  assert.doesNotMatch(html,/https?:\/\/|_next|_vinext|localhost|cloudflare|RSC/i);
  const entry=await readFile(new URL("../mobile-web/main.tsx",import.meta.url),"utf8");
  assert.match(entry,/createRoot\(root\)\.render/);assert.doesNotMatch(entry,/hydrateRoot|next\//);
  assert.equal((entry.match(/Date\.now\(\)/g)??[]).length,1);assert.match(entry,/<YiApp initialNow=\{initialNow\}/);
  const app=await readFile(new URL("../app/YiApp.tsx",import.meta.url),"utf8");
  assert.match(app,/new Audio\(assetUrl\(/);assert.match(app,/image.src = assetUrl\(media.src\)/);assert.match(app,/video.src = assetUrl\(cubeVideo.src\)/);
  assert.doesNotMatch(app,/(?:image|video)\.src = (?:media|cubeVideo)\.src/);
  const files=await readdir(new URL("assets/",output));const css=(await read(`assets/${files.find(f=>f.endsWith(".css"))}`)).toString();
  assert.match(css,/@font-face/);assert.match(css,/100dvh/);assert.match(css,/safe-area-inset-top/);
  assert.doesNotMatch(css,/https:\/\/(?:fonts|cdn)|\/Users\/|_next|_vinext/);
  const fonts=files.filter(f=>f.endsWith(".woff2"));assert.equal(fonts.length,11);
  for(const file of fonts)assert.equal((await read(`assets/${file}`)).subarray(0,4).toString(),"wOF2");
  assert.match((await read("fonts/OFL.txt")).toString(),/SIL OPEN FONT LICENSE/);
});

test("shared UI renders all major screens in standalone mode without Worker/request data", () => {
  configureRuntime({kind:"standalone-web",assetBase:"/"});
  const initialNow=Date.parse("2026-10-03T02:00:00Z");const html=renderToString(createElement(YiApp,{initialNow}));
  for(const text of ["Your wellbeing","Meditation timer","Journal prompt","Body &amp; cycle","Record a period start for cycle days","Export browser data"])assert.ok(html.includes(text),text);
  assert.equal(html,renderToString(createElement(YiApp,{initialNow})),"same snapshot has deterministic initial markup");
  assert.doesNotMatch(html,/https?:\/\/|_next\/image|_vinext|cloudflare|signin-with-chatgpt/);
  configureRuntime({kind:"hosted-web",assetBase:"/"});
});

test("media URLs retain hosted behavior and resolve within standalone subdirectories", () => {
  configureRuntime({kind:"hosted-web",assetBase:"/"});assert.equal(assetUrl("/gong-sounds/gong-1.wav"),"/gong-sounds/gong-1.wav");
  configureRuntime({kind:"standalone-web",assetBase:"/proof/"});assert.equal(getRuntime().kind,"standalone-web");assert.equal(assetUrl("/cube-media/picture-01.jpg"),"/proof/cube-media/picture-01.jpg");
  assert.throws(()=>configureRuntime({kind:"standalone-web",assetBase:"https://remote.invalid/"}));assert.throws(()=>assetUrl("//remote.invalid/image.jpg"));
  configureRuntime({kind:"hosted-web",assetBase:"/"});
});

test("complete production media are byte-identical to shared public assets", async () => {
  const assets=[...Array.from({length:43},(_,i)=>`cube-media/picture-${String(i+1).padStart(2,"0")}.jpg`),"cube-media/wedding.mov",...['gong-1','gong-2','gong-3','tripple-gong'].map(name=>`gong-sounds/${name}.wav`),"favicon.svg"];
  for(const asset of assets) assert.equal(hash(await read(asset)),hash(await readFile(new URL(`../public/${asset}`,import.meta.url))),asset);
});

test("plain static server serves HTML, JS, CSS, fonts, images and ranged audio/video at root and subpath", async () => {
  const files=await readdir(new URL("assets/",output));
  for(const base of ["/","/proof/"])await withServer(base,async origin=>{
    const response=await fetch(origin);assert.equal(response.status,200);const html=await response.text();
    for(const relative of [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map(m=>m[1]))assert.equal((await fetch(new URL(relative,origin))).status,200,relative);
    for(const asset of [...files.filter(f=>f.endsWith('.woff2')).map(f=>`assets/${f}`), ...Array.from({length:43},(_,i)=>`cube-media/picture-${String(i+1).padStart(2,"0")}.jpg`), ...["gong-1","gong-2","gong-3","tripple-gong"].map(name=>`gong-sounds/${name}.wav`), "cube-media/wedding.mov"]){
      const resource=await fetch(new URL(asset,origin),{method:"HEAD"});assert.equal(resource.status,200,asset);assert.ok(Number(resource.headers.get("content-length"))>0);
    }
    for(const media of ["cube-media/wedding.mov","gong-sounds/gong-1.wav"]){const response=await fetch(new URL(media,origin),{headers:{Range:"bytes=0-31"}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,32);assert.match(response.headers.get("content-range"),/^bytes 0-31\//);}
    for(const route of ["_next/image","_vinext/rsc","api/health","signin-with-chatgpt"])assert.equal((await fetch(new URL(route,origin))).status,404);
  });
});

test("standalone module graph has no server modules and blocks framework regressions", async () => {
  const result=await build({configFile:config,build:{write:false},logLevel:"silent"});
  const chunks=result.output.filter(item=>item.type==="chunk");assert.ok(chunks.length);
  const modules=chunks.flatMap(chunk=>Object.keys(chunk.modules));
  assert.ok(modules.some(id=>id.endsWith("/app/YiApp.tsx")));
  assert.ok(modules.some(id=>id.endsWith("/src/adapters/local/repository.ts")));
  assert.ok(modules.some(id=>id.endsWith("/src/services/health-service.ts")));
  assert.ok(!modules.some(id=>/\/node_modules\/(?:vinext|@cloudflare|@openai\/sites|react-server-dom)|\/app\/(?:layout|page|chatgpt-auth)\.|\/(?:worker|db)\//.test(id)),modules.join("\n"));
  const fixture = source => ({name:"boundary-regression-fixture",enforce:"pre",transform(code,id){if(id.endsWith("/mobile-web/main.tsx"))return `import ${JSON.stringify(source)};\n${code}`;}});
  for(const source of ["next/image","next/font/google","next/headers","vinext","cloudflare:workers","node:fs","../app/chatgpt-auth"]){
    await assert.rejects(build({configFile:config,plugins:[fixture(source)],build:{write:false},logLevel:"silent"}),/forbidden in the standalone build/);
  }
});
