# Phase 2: standalone client build proof

## Scope and result

A separate Vite client build now mounts the same `app/YiApp.tsx` UI using `createRoot`. The existing vinext/Cloudflare hosted path remains intact. No Firebase, Capacitor, iOS/Xcode project, HealthKit, or Tempdrop integration was added. No Phase 0/1 repository, schema, migration, fixture separation, or normalized-health implementation was changed.

Build-level proof succeeds: a complete `dist-mobile/index.html`, bundled JavaScript/CSS, local fonts and license, and shared public images/video/gongs are emitted without Workers, SSR, hosting identity headers, Next font loading, image optimization, or external asset services. Automated tests verify static HTTP delivery and shared-screen rendering. **Interactive browser acceptance is still pending:** no browser connection was available to this agent, so DOM interaction, browser persistence, console errors, playback, and disconnected-network behavior were not personally verified.

## Commands and output

| Purpose | Command | Address/output |
| --- | --- | --- |
| Existing hosted development | `npm run dev` | Normally `http://localhost:3000` |
| Existing hosted production build | `npm run build` | Existing `dist/client` + `dist/server` |
| Existing hosted production server | `npm run start` | Existing vinext server |
| Standalone development | `npm run dev:standalone` | `http://127.0.0.1:5174` |
| Standalone production build | `npm run build:standalone` | **`dist-mobile`** |
| Plain static production server | `npm run serve:standalone` | `http://127.0.0.1:4174` |
| Vite production preview (alternative) | `npm run preview:standalone` | `http://127.0.0.1:4174` |
| Existing tests, including hosted production build | `npm test` | 21 passing tests |
| Standalone production build + checks | `npm run test:standalone` | 6 passing tests |
| Standalone TypeScript | `npm run typecheck:standalone` | Passes |
| Lint | `npm run lint` | Passes |

The future Capacitor `webDir` is exactly `dist-mobile`, or `/Users/calemanderson-barwin/github/Equanimity/dist-mobile` in this workspace. Do not give Capacitor `dist/client`, and do not set its future server URL to a localhost development server. No Capacitor configuration exists yet.

`npm run serve:standalone -- 4175` selects a different static-server port if 4174 is occupied. Preview and the static server use the same default port; run only one on that port. Development and build use the already-installed React/Vite plugins; no packages or lockfile changes were required.

## Entry and runtime boundary

- Hosted: `app/page.tsx` still captures server time and serializes `initialNow` for hydration; `app/layout.tsx` and the original Vite/Worker configuration are unchanged.
- Standalone: `mobile-web/main.tsx` captures one `initialNow` at startup and mounts the shared UI with `createRoot`. There is no server markup or hydration step. Existing Toronto calendar rules, quote rollover, and timer deadline callbacks are retained.
- `src/platform/runtime.ts` distinguishes `hosted-web`, `standalone-web`, and a reserved `native-shell` mode. Native mode is not activated or detected; the future shell must explicitly configure it.
- `assetUrl` preserves the current root-relative URLs for hosted web and prefixes them with the standalone document's local asset directory. This includes image preload, video preload, video elements/posters, cube backgrounds, and gongs. Production entry/CSS/font URLs use Vite's relative base. Root and nested-folder serving are tested.
- Standalone builds reject Next, vinext, Cloudflare, Node runtime modules, Sites build plugins, RSC packages, and hosted auth/page/layout entries. Regression tests intentionally attempt prohibited imports and require build failure.
- Standalone dependency optimization uses its own `node_modules/.vite-standalone` cache so it does not overwrite the hosted development optimizer cache.
- The UI currently has no `next/image` dependency, so no image shim or UI rewrite was necessary. Hosted fonts/auth helpers remain isolated outside the standalone module graph.

## Local fonts and assets

Geist and Geist Mono WOFF2 subsets were copied byte-for-byte from the existing hosted font cache into tracked `mobile-web/fonts` assets. `fonts.css` uses local relative URLs; the standalone build does not require that cache or a hosted build to exist. All 11 current font subsets are emitted as hashed Vite assets, covering the same cached unicode ranges. Serif headings continue to use the existing OS font stack; missing glyphs use browser/OS fallbacks.

The complete SIL Open Font License notice is included in source and emitted as `dist-mobile/fonts/OFL.txt`. Source license: [Google Fonts Geist OFL notice](https://raw.githubusercontent.com/google/fonts/main/ofl/geist/OFL.txt); [Geist Mono notice](https://raw.githubusercontent.com/google/fonts/main/ofl/geistmono/OFL.txt).

Vite copies the existing public directory, including the 43 current cube photos, `wedding.mov`, four gong WAV files, and existing static assets. Tests compare the required media against source checksums and serve every current photo, gong, and font. The static server supports byte ranges for audio/video. Resolution is verified; codec compatibility and audible/autoplay behavior still need browser/device checks. Unused older public images are also copied to avoid deleting or replacing existing assets; asset pruning is deferred.

The production frontend has no localhost URL or Cloudflare binding dependency. Localhost addresses occur only in development/test serving instructions and tooling. The plain static server is a disk-file server, not a Worker or a framework/SPA fallback: requests for `_next/image`, `_vinext/rsc`, auth, and API routes return 404.

## Mobile prerequisites, not a redesign

The standalone HTML sets `width=device-width, initial-scale=1, viewport-fit=cover`. Standalone-only CSS supplies font variables and safe-area variables/top/side padding; existing bottom navigation and modal bottom insets remain in use. `100dvh` and dynamic modal height limits are enabled inside feature detection, with existing `vh` fallbacks. Natural document scrolling is retained; no fixed-height root or new gesture/navigation system was introduced. Shared `app/globals.css` was not changed by Phase 2.

## Tests and verification limits

- `npm test`: hosted production build succeeds; all 21 existing tests pass, including the Phase 0/1 backup, migration, ID, validation, provenance, and repository round-trip cases.
- `npm run test:standalone`: standalone production build succeeds; all 6 standalone checks pass. They cover the HTML/client snapshot/viewport/font entry, shared-screen rendering with deterministic initial markup, hosted/nested asset paths, byte-identical media, plain HTTP root/nested serving with media ranges, and module-graph/boundary regressions.
- `npm run lint` and `npm run typecheck:standalone`: pass. Whole-repository TypeScript still reports the previously missing Cloudflare backend types; they are excluded from the standalone TypeScript entry and bundle, not silently patched.
- Both new development and static serving commands were started successfully. The static server returned the compiled index; the development entry compiled as a Vite client module.
- Sandbox networking required approval for local listening ports; ordinary terminal use does not require this product-specific approval. Automated checks use loopback ports and in-memory storage tests, not personal browser storage.
- Browser discovery returned no available browsers. Server-side shared UI render tests are **not** a substitute for real browser DOM/event/console checks. No claim is made that interactive persistence, media playback, or offline browser reload has been tested.

## Compromises and remaining dependencies

1. There are no hosted server dependencies in the standalone client module graph. A normal browser still needs a static HTTP origin to load ES modules; double-clicking `index.html` via `file://` is not the supported test path.
2. Standalone storage is still origin-local. `localhost`, `127.0.0.1`, and different ports are different origins. A fresh standalone origin is expected to have empty real history. It does not import or synchronize production browser data automatically. Same-origin hosted/standalone pages use the same Phase 1 keys and protections.
3. Hosted identity helpers/routes remain hosted-only and are not recreated in standalone mode. No identity feature is required by the current shared screens.
4. No service worker or PWA caching layer was added. All required assets are local files, so internet access is unnecessary while the local static server is available. Disconnecting all browser network access can still prevent HTTP reloads or later uncached media requests. A future bundled native shell supplies local assets; this is not a claim that a native shell has been tested.
5. Browser notifications, downloads, storage permissions, and timer/audio execution while backgrounded remain browser-policy dependent. Native background timers, notifications, file export, permissions, and native storage are future work. Video codec/autoplay support needs device testing; load failure retains the existing photo fallback.
6. Font binaries are deliberately pinned copies of the current cache, not downloaded dynamically. Future hosted font updates will need an explicit matching local asset update.
7. No security/authentication, sync policy, Firebase schema/rules, or native bridge was implemented. Existing Phase 0/1 limits around ambiguous legacy provenance, repairs, and restore/import remain unchanged.

## Exact manual browser acceptance steps

1. From the repository, run `npm run build:standalone`, then `npm run serve:standalone`. Open **`http://127.0.0.1:4174/`**, not a file URL. If it is already running from this task, simply open the address; do not start another process on the same port.
2. Open developer tools **Console** and **Network**, then reload. Wait for fonts and cube photos/video to load. Verify there are no uncaught application errors and no missing JS/CSS/fonts/media.
3. Confirm **Insights**, **Practice**, and **Journal** switch normally. Open cycle logging, a journal composer, book logging, and expanded analytics. Check the existing long/short quote card and cube layout have not been redesigned. In responsive mode, check document scrolling and that modal controls/navigation remain accessible.
4. In Network, verify all application asset requests stay on `127.0.0.1:4174`. There should be no Google Fonts, `_next/image`, `_vinext`/RSC, Worker/API, hosting auth, or remote asset requests. Vite HMR requests are expected only on development port 5174, never in this production build. Browser extensions may generate unrelated traffic; distinguish them from application requests.
5. Check cube photos rotate and the existing muted video plays or falls back appropriately. In Practice, use the gong preview controls to hear **Gong 1**, **Gong 2**, **Gong 3**, and **Tripple Gong**. Confirm fonts appear in developer tools' rendered-fonts panel as Geist/local WOFF2 (serif headings remain system fonts).
6. A fresh standalone origin should show empty real journal/health history. Save a uniquely labelled test journal entry, reload at the same address, and confirm it remains. Save one explicit cycle field; reload and verify untouched fields remain unrecorded. Save a timer, start it, reload and confirm its deadline is restored, then stop/reload to check it does not resurrect.
7. Expand **Data backup & review**, export a backup, and verify the versioned records include your intentional test edits. Legacy values and the original backup must remain intact. Do not clear storage, copy production records manually, or reset keys to troubleshoot. See the Phase 0/1 guide for read-only original-byte comparisons.
8. To check without internet, keep the static server running and turn off external internet access while preserving loopback access. Reload and repeat the main interactions. No external asset service should be needed.
9. Separately, after an initial successful load, set developer tools Network to **Offline**. Check already-loaded screens and local journal editing continue to operate, then restore Online and reload to verify the saved edit. Uncached media and full offline reload can fail because this build intentionally has no service worker; record which requests fail instead of interpreting them as a cloud dependency.
10. Run `npm run dev:standalone` and open **`http://127.0.0.1:5174/`** to check the development path. Its storage is separate from port 4174. Run `npm run dev` at **`http://localhost:3000/`** to recheck the original hosted experience. Preserve the original production profile/origin and never clear its data.

## Readiness decision

The standalone **build prerequisite** for later Capacitor packaging is now in place: `dist-mobile` is complete and server-independent. The Phase 1 domain/repository boundary remains suitable for beginning Firebase design/implementation as a separately authorized phase. However, Phase 2 should not be called fully browser-accepted until the manual console, interaction, persistence, media, and offline checks above pass. Native packaging will additionally require WKWebView/device testing, permissions/background behavior, and a deliberate storage-origin/data-transfer plan. No further phase has begun.

## Every file added or changed in Phase 2

Modified:

- `.gitignore` — ignore standalone generated output.
- `package.json` — standalone development/build/static serving/check commands.
- `eslint.config.mjs` — exclude generated standalone bundles from source linting.
- `app/YiApp.tsx` — local runtime asset resolution at media usage sites only.
- `tests/typescript-loader.mjs` — support TSX shared-screen test imports.

Added:

- `mobile-web/index.html`
- `mobile-web/main.tsx`
- `mobile-web/vite.config.ts`
- `mobile-web/vite-env.d.ts`
- `mobile-web/tsconfig.json`
- `mobile-web/standalone.css`
- `mobile-web/fonts/fonts.css`
- `mobile-web/fonts/OFL.txt`
- `mobile-web/fonts/geist-001175b1.woff2`
- `mobile-web/fonts/geist-52306abf.woff2`
- `mobile-web/fonts/geist-875ccdd4.woff2`
- `mobile-web/fonts/geist-98bbbccb.woff2`
- `mobile-web/fonts/geist-ff2310f5.woff2`
- `mobile-web/fonts/geist-mono-013b2f2f.woff2`
- `mobile-web/fonts/geist-mono-0638449e.woff2`
- `mobile-web/fonts/geist-mono-44745446.woff2`
- `mobile-web/fonts/geist-mono-44e03052.woff2`
- `mobile-web/fonts/geist-mono-971fb274.woff2`
- `mobile-web/fonts/geist-mono-f6b33328.woff2`
- `src/platform/runtime.ts`
- `scripts/serve-standalone.mjs`
- `tests/standalone-build.test.mjs`
- `docs/standalone-phase-2.md`

Generated/ignored: `dist-mobile` (standalone output), `dist`/`.vinext` (existing hosted build output/cache), and existing Vite dependency caches. No source assets, old user records, unrelated uncommitted changes, or hosted deployment configuration were deleted or replaced. Git staging changed externally while working; no git index/reset/checkout/commit operation was performed by this task.
