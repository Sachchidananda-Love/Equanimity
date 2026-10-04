# Capacitor iOS shell

## Identity and scope

Equanimity uses `win.calemandersonbar.equanimity`, Capacitor core/CLI/iOS **8.5.2**, Swift Package Manager (no CocoaPods), and `webDir: "dist-mobile"`. The app bundles standalone Vite assets, not the hosted vinext/Cloudflare build. Its virtual WKWebView origin is `capacitor://equanimity.local`; this is not a development server or DNS dependency. There is no production server URL, localhost host, permissive navigation, or ATS exception.

Minimum iOS is **15.4**, because existing application code uses `structuredClone` and `Array.at`, introduced in [WebKit 15.4](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/). The Capacitor framework's SPM minimum remains 15.0; the application target is higher. Build verified with Node 25.2.1, npm 11.6.2, Xcode 26.6, and an iPhone 17 Pro simulator running iOS 26.5. Capacitor requires Node 22+ and Xcode 26+: [environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup).

No React, mobile CSS, Firebase repository, rules, project, or collections were changed. No local records are imported or merged. No Android, native Firebase, HealthKit, Tempdrop, push, Storage, or distribution setup was added. Generated icon and launch artwork are Capacitor placeholders.

## Everyday workflow

After changing web code or environment configuration:

```sh
npm run ios:prepare
```

This builds the standalone app, checks its Firebase configuration and local entry assets, syncs iOS through Capacitor, and verifies that every copied web asset matches the standalone output. Errors stop the workflow. Open Xcode with:

```sh
npm run ios:open
```

On a fresh checkout run `npm ci`, configure the existing public `VITE_FIREBASE_*` settings in `.env.local`, and run `npm run ios:prepare` before opening/building Xcode. Native bundled assets/configuration and DerivedData are intentionally ignored; the native project and SPM lockfile are tracked. `ios:sync` only syncs an existing build; use `ios:prepare` after source changes. `test:ios-shell` requires a prepared bundle.

The production Vite build receives the existing public Firebase variables. The verifier checks enabled state, four required public configuration values, and that emulator mode is disabled, without printing their values. Firebase web configuration necessarily appears in bundled JavaScript, as it does on the website; never put private credentials in Vite variables. No Firebase configuration is embedded in Swift or a GoogleService-Info.plist. Do not commit generated native public assets or `.env.local`.

## Firebase and origin acceptance

The existing email/password Firebase Web SDK and Firestore HTTPS path are retained. They are expected to work in WKWebView; this is not a claim of live native-cloud acceptance. Firebase documents iOS Safari/Cordova support and limitations for phone and OAuth popup/redirect flows: [supported environments](https://firebase.google.com/docs/web/environments-js-sdk). Those additional authentication flows were not added.

No mandatory Firebase Console change has been established for the current email/password flow. Test it first. If Firebase reports `auth/unauthorized-domain`, inspect Authentication > Settings > Authorized domains and, if required by that flow, authorize the hostname `equanimity.local` (not the full custom-scheme URL). Retain existing domains. If HTTP-referrer API-key restrictions or App Check enforcement reject the custom WKWebView origin, resolve that specific policy with the project administrator; do not disable protections globally or weaken Firestore UID rules. A native Firebase app registration is not needed merely to continue using the existing Web SDK.

Authentication remains memory-based: terminating/restarting the app requires signing in again. Cloud records remain stored in Firestore. No durable offline cloud queue or native credential persistence was introduced. Custom-scheme secure-context APIs and all live networking still need device acceptance. The app's bundled shell can load independently of a development server; airplane-mode startup was not separately tested. Cloud sign-in and records require networking under the existing architecture.

## Xcode and manual checks

1. Run `npm run ios:prepare`, then `npm run ios:open`. Select the **App** scheme and an installed iPhone simulator, then Run. Allow SPM downloads to finish. No signing team is needed for the simulator.
2. Confirm the existing cloud sign-in screen renders; test keyboard resizing, visible input focus, scroll reachability, safe areas/notch, status bar, portrait/landscape, and modal dismissal.
3. Sign in with your existing test account. Check journal, timer presets, activity presets, books, cycle events, health records, and syncing preferences. Create/update/delete test records; reload/relaunch, sign back in, and confirm records and tombstones persist. Do not mistake default content for uploaded user data.
4. Sign out: private records must disappear. Sign in again: the same cloud dataset should return. A second authorized test UID must not see the first UID's data. Explicit local-only fallback must remain separate and must never upload local demo records.
5. Test invalid credentials, offline/airplane mode, denied access, reconnect, and error/loading feedback. Launch offline to check bundled UI; do not expect offline cloud sign-in or writes.
6. Start a timer, background/foreground the app, then terminate/relaunch and sign back in to check deadline recovery. iOS suspension does not guarantee continuous JavaScript execution or background gong playback. Test all gongs after a user gesture, silent-mode behavior, video playback/controls, and interrupted audio. No native background audio or notifications were added.
7. For a physical iPhone, add your Apple ID in Xcode Settings > Accounts; choose the App target > Signing & Capabilities, enable automatic signing, and choose your Team without changing the bundle ID. Pair/trust the device, enable Developer Mode where required, select it, and Run. Provisioning/team access and a compatible iOS version are manual prerequisites; no signing identity or team was committed.

## Verification performed

- Application/data tests: 38 passed (`npm test`, including hosted production build).
- Standalone tests: 6 passed (`npm run test:standalone`, including standalone production build).
- Firebase emulator tests: 2 passed; synthetic fixtures only, no live cloud writes.
- iOS shell tests: 4 passed; identity, packages/SPM/security, deployment target, and copied asset equality.
- Lint and standalone TypeScript checks passed.
- `npm run ios:prepare` and Capacitor sync passed; public Firebase configuration was verified without disclosure.
- Xcode opened successfully. Unsigned simulator compilation succeeded. App installed and launched on iPhone 17 Pro/iOS 26.5; screenshot inspection confirmed the existing sign-in screen renders in WKWebView.

A separate initial package-resolution attempt hit a transient shared SPM artifact-cache collision while Xcode was also resolving packages. Subsequent native compilation succeeded without deleting caches. Existing dependency/audit and bundle-size warnings were not fixed through unrelated upgrades.

No known build blocker remains for simulator testing. Physical-device signing/pairing and live Firebase origin/network acceptance remain unverified. Keyboard, media, orientation, offline states, and suspension/resume require the checks above before considering this shell device-ready. No TestFlight/App Store work was performed.

## Every added or changed file

Changed existing files: `.gitignore`, `eslint.config.mjs` (generated native build outputs only), `package.json`, `package-lock.json`.

Added integration files: `capacitor.config.ts`, `scripts/verify-ios-web.mjs`, `scripts/verify-ios-shell.mjs`, `tests/ios-shell.test.mjs`, `docs/capacitor-ios-shell.md`.

Added native files:

- `ios/.gitignore`
- `ios/debug.xcconfig`
- `ios/App/App.xcodeproj/project.pbxproj`
- `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist`
- `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`
- `ios/App/App/AppDelegate.swift`
- `ios/App/App/SceneDelegate.swift`
- `ios/App/App/Info.plist`
- `ios/App/App/Base.lproj/Main.storyboard`
- `ios/App/App/Base.lproj/LaunchScreen.storyboard`
- `ios/App/App/Assets.xcassets/Contents.json`
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`
- `ios/App/App/Assets.xcassets/Splash.imageset/Contents.json`
- `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png`
- `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png`
- `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png`
- `ios/App/CapApp-SPM/.gitignore`
- `ios/App/CapApp-SPM/Package.swift`
- `ios/App/CapApp-SPM/README.md`
- `ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift`

Build outputs (`dist`, `dist-mobile`, native public/config files, DerivedData, user-specific Xcode state) were generated but are ignored, not native source deliverables.
