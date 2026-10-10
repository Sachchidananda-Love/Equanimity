# Private-beta privacy Hosting

This setup deploys only the static `privacy-site/` directory to the Firebase Hosting site `equanimity-yi` in the existing project of the same name. It does not deploy the app, Firestore rules, Authentication changes, or the personal website. No deployment has been performed.

Public policy text: [privacy-policy.md](privacy-policy.md). Served copy: [../privacy-site/privacy/index.html](../privacy-site/privacy/index.html). The implementation audit remains a historical technical audit, not the public policy.

## Before deployment

1. Replace the single `PRIVACY_CONTACT_EMAIL` occurrence in **each** policy copy with the same monitored email address. This is one outstanding contact value, not multiple contacts. It is currently plain text, not a broken placeholder mail link.
2. Replace `EFFECTIVE_DATE` in both copies with the actual publication date, for example `October 12, 2026` if that is the day you deploy. Deployment does not automatically choose a date. No other policy placeholders remain.
3. Review the final text. In Firebase Console → Hosting, confirm that site `equanimity-yi` is available for this privacy site and is not serving another site or linked to your personal custom domain. A Hosting deployment replaces the selected site's live release, not just one subdirectory. If that site is already used for your personal website, **stop**: use a separate Hosting site instead and adjust the site ID/URL deliberately. No domain/DNS change is needed for `web.app`.

Only `privacy-site/privacy/index.html` and `privacy-site/privacy/style.css` ship. No SDKs, script tags, fonts, media, account data, source documents or `.env` files are published. Hosting handles HTTPS and its own service-request metadata; “no analytics” does not mean Firebase sees no web requests.

## Manual commands

Run from the repository root. The existing `firebase-tools` dependency supplies the CLI; no `firebase init` is required and it could overwrite configuration.

```sh
npx firebase login
npx firebase use equanimity-yi
node --test tests/privacy-hosting.test.mjs
npx firebase deploy --only hosting --project equanimity-yi
```

Skip login if already authenticated with the correct Firebase administrator account. If access is wrong, use `npx firebase login --reauth`. The explicit `--project` and configured Hosting `site` prevent accidental selection of a different project/site. Never use a bare `firebase deploy` for this task.

If the named default Hosting site does not yet exist and the deploy reports it missing, create that site in the same project:

```sh
npx firebase hosting:sites:create equanimity-yi --project equanimity-yi
npx firebase deploy --only hosting --project equanimity-yi
```

Only do that if the name is available for this project. If it is unavailable, do not select someone else's site or change personal domains; choose a separate available site ID, change `hosting.site` to it, and use `https://<site-id>.web.app/privacy/`.

Firebase documents directory-scoped static hosting and Hosting-only deployment in its [Hosting quickstart](https://firebase.google.com/docs/hosting/quickstart) and [Hosting configuration reference](https://firebase.google.com/docs/hosting/full-config).

## Verify and configure the app afterward

Expected public URL:

```text
https://equanimity-yi.web.app/privacy/
```

Open it on a phone and confirm readable text, correct contact/date, and no editorial placeholders. The site's root redirects to `/privacy/`. Neither endpoint is behind Firebase Authentication: the policy is intentionally public, but contains no private app data.

After a successful deployment, manually set the following in your existing production build environment or `.env.local`:

```dotenv
VITE_PRIVACY_POLICY_URL=https://equanimity-yi.web.app/privacy/
```

Then run:

```sh
npm run ios:prepare
```

Verify Account & data → Privacy in the prepared Release app. The URL is compiled into the web bundle, so setting the environment variable alone does not update an already-built app.

## Updating the policy

Keep the Markdown and HTML copies identical when changing wording; the focused test checks their text equivalence, placeholders, static page boundary and preserved Firestore/emulator config. It permits the requested contact/date placeholders during preparation, so **passing tests is not permission to publish placeholders**. Update the effective date for a changed public version, then deploy only Hosting again. No app rebuild is needed for policy-text updates at the same URL.
