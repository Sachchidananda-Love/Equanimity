# Equanimity Privacy Policy

Effective date: October 9, 2026

## About this private beta

This policy covers Equanimity's current private iPhone TestFlight beta for explicitly approved users. The beta is intended for adults aged 18 and over; the app does not verify age.

Equanimity helps you keep a personal journal, record meditation practice and reading, and track body and cycle observations. It uses Firebase for private account storage and keeps local copies for offline use. This policy does not cover the operator's separate personal website.

## Information stored and how it is used

Depending on what you enter, save, or choose to import, Equanimity stores:

- Account email address, Firebase user identifier, and authentication/session information.
- Journal titles, reflections, dates, activities, durations, mood, tags, assessments and notes, and associated cycle or lunar context.
- Saved practice records, timer and gong configurations, book titles/authors, reading dates and assessments, activity presets, and dashboard/settings preferences.
- Manual cycle and body observations: period starts, menstrual flow, temperature and source, cervical mucus and sensation, cervical observations, ovulation/pregnancy tests, sexual activity, symptoms, energy, sex drive, PMS, disturbances, medication notes, other notes, and any sleep measures you enter.
- Eligible imported health records, including values, units, dates/times, time zone, sample identifiers, and selected source-app/device metadata.
- Record identifiers, timestamps, revisions, pending edits, and import/recovery status.

This information is used to display and edit your records, run and recover practice timers, calculate cycle context and patterns, preserve source attribution, and synchronize the correct account. Free-text fields may contain sensitive information you choose to enter.

## Accounts and Firebase cloud storage

Equanimity uses Google Firebase Authentication for email-and-password sign-in. Credentials are sent to Firebase; the app's own record cache does not store your password. Firebase manages persistent authentication sessions on the device. Account access is limited to explicitly approved users.

Saved journal, practice, reading, preferences, and manual body/cycle records are stored in Cloud Firestore and the account's local recovery cache. Eligible Apple Health records are uploaded only through the separate consent-controlled import described below.

Firestore records and pending account edits are scoped to your Firebase user identifier. Switching accounts does not transfer another account's records or pending writes. Other ordinary users cannot access your records through the app, but authorized project administrators may access cloud data for administration. This is not end-to-end encryption.

The production Firestore database is in Montréal, Canada, in the northamerica-northeast1 region. This does not mean all Firebase authentication, operational processing, or support infrastructure is confined to Canada. Firebase receives normal service-request metadata; its authentication service processes IP addresses and user-agent information for security and abuse prevention. See [Firebase's privacy information](https://firebase.google.com/support/privacy).

## Apple Health / HealthKit and Tempdrop

Apple Health access and importing health records are optional. The Release app requests read access only to basal body temperature, menstrual flow, and cervical mucus quality. Equanimity does not request write access or write to Apple Health.

Apple Health permission and Equanimity cloud-import consent are separate. Granting Apple Health permission alone does not upload your records. To import, you enable selected Apple Health cloud sync for your account on that device and initiate an import. The current import reads a recent 90-day window, not a continuous background feed.

The app may read permitted samples from different source apps to identify their origin. Only verified Tempdrop-origin temperature, menstrual-flow, and cervical-mucus records are currently eligible for persistent import; other sources are skipped. Imported records retain sample/source identifiers and selected app/device information, including versions, model or local source-device identifier when available, and relevant cycle-start/synchronization metadata. Arbitrary raw inspection JSON is not uploaded.

Equanimity does not connect directly to Tempdrop's API, collect Tempdrop credentials, or send records to Tempdrop. It reads eligible information Tempdrop has already written to Apple Health. You can also enter temperatures manually. Automatic HealthKit sleep import is not part of this Release beta.

You can change Apple Health permissions in iOS and turn off Equanimity's cloud-import consent to stop further import uploads. Neither action deletes copies already imported or a retained pending import batch. There is no dedicated in-app control to erase all imported copies. Equanimity does not delete originals held in Apple Health or Tempdrop.

## Cycle and fertility estimates

Cycle context, temperature patterns, and fertility-likelihood outputs are calculated using explicit app rules. They are estimates, not medical diagnoses, validated contraception, or guarantees about pregnancy or ovulation. Missing or conflicting information can make them uncertain. Equanimity makes no claim of medical-device certification or medical guarantees.

## Local storage, offline use, and sign-out

The app retains the last usable account dataset, pending edits/imports, session information, import consent/time, and recovery state in device-local storage. Active timer/stopwatch checkpoints and quote rotation state are device-only, rather than cloud practice records. Any existing legacy local dataset or migration backup also remains on the device; it is not silently assigned to a new cloud account.

Offline relaunch can reopen the last locally authorized account's cache without new network authentication. Pending edits stay associated with their original account and can sync after connectivity and matching authentication return. Someone using your unlocked device may see its open account.

Sign-out closes visible account state and prevents normal reopening of that account's cache, but does not erase retained device caches, outboxes, import batches/preferences, or account recovery checkpoints. Retry a reported sign-out failure before sharing the device. There is no general in-app cache-erasure control.

The iOS app attempts to exclude its WebKit storage directory, including locally cached health records and pending edits, from device/iCloud backups. This depends on successful application of the exclusion and iOS/WebKit behavior; it does not remove prior backups. Unsynced device-only edits may be lost after device replacement or backup restore.

Deleting the app normally removes app-container data; offloading retains it. Neither deletes Firestore records or Apple Health originals. Sync before uninstalling or replacing the device.

## Retention and account/data deletion

There is currently no automatic expiry period for cloud records, retained device caches, or pending writes. Completed pending operations are cleared, while the usable account dataset stays cached.

Removing an entry from a visible list does not necessarily erase its stored contents. The cloud implementation can retain the original record marked as deleted, and health source records can remain as deleted or superseded for reconciliation. Sign-out, uninstall, and permission/consent withdrawal do not erase cloud copies.

Full in-app account deletion and complete data erasure are not currently implemented. You can contact the operator using the address below to request account/data deletion or ask about access and correction. These requests require manual handling; this policy does not promise an automated deletion feature or a fixed completion deadline. Deleting a Firebase authentication account alone does not automatically delete its Firestore records in this implementation. Device-local copies and pending writes must also be considered during deletion.

Firebase and Apple's own operational records and backups are subject to their service retention practices.

## Sharing, advertising, analytics, and beta diagnostics

We do not sell personal or health data, use it for advertising, or use behavioral analytics. Equanimity does not send journal or health records for remote AI processing. There are no public social profiles or public journal-sharing features.

Firebase receives information to provide authentication and cloud storage. Apple Health is accessed on the device. The app does not request location, camera, or microphone access. Its bundled personal photos, video, and quotes are shared app content approved for this private beta, not photos collected from your device or private account uploads.

The app has no advertising SDK, Firebase Analytics, Firebase Crashlytics, or application-log upload endpoint. Release hides raw inspection/development tools and disables development diagnostics; a non-sensitive native warning can still be emitted if backup exclusion cannot be verified. Debug builds can log native responses containing health information. Treat debug logs, exports, and downloaded app containers as private.

TestFlight separately collects crash logs and usage information automatically and shares them with the app provider; this collection cannot be opted out of. Submitted feedback, including screenshots/comments, is also shared. Name/email visibility depends on the invitation method. See [Apple's TestFlight privacy information](https://www.apple.com/legal/privacy/data/en/test-flight/). Do not include sensitive records in feedback unless you intend to share them. You can ask the operator about support correspondence or diagnostic copies retained outside the app.

## This policy page and external links

This policy page is a static Firebase Hosting site. We add no cookies, analytics, scripts, external fonts, or tracking resources, and it contains no account or health records. Firebase Hosting still receives ordinary web-request information, including IP addresses, to serve and operate the site. Opening external resource links involves the destination's own privacy practices; the app does not attach journal or health records to those links.

## Security and changes

The app uses Firebase authentication, UID-based ownership controls, Firestore security rules, account-scoped recovery storage, and guarded retries. Local data relies on device/operating-system protections, not an additional encrypted app vault. No system can be guaranteed completely secure; protect your device and account credentials.

This policy will be updated when the beta's data practices change. The effective date identifies the current version. The published policy is accessible from Account & data; there is no dedicated privacy-change notification system.

## Contact

For privacy questions and account/data deletion requests, contact the Equanimity beta operator at:

calem.cab@gmail.com
