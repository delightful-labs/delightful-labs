# Chromium extension release from the monorepo

The extension is built from `apps/clipper/apps/extension`. Its public identity is
`inbajlgglggigfebfkmlkfbdenddpphf`, derived from the public manifest key in
`../tooling/extension-identity.ts`. Preserve that key and identity for existing
installations. The web backend admits this extension origin.

The production defaults are `https://clipper.delightfullabs.com/`, its `/jazz`
endpoint and public Jazz app ID `9c0871ad-3ea3-49d0-9eaf-b034914da924`. The current
manifest version is `0.0.3`; the package.json version is not the store version.
There is no automated store upload/release job. CI builds a separate test package
and runs the packaged Chromium suite against an isolated local backend.

## Build a production candidate

Run from the monorepo root with Node 24.22.2 and pnpm 10.28.0:

```sh
pnpm install --frozen-lockfile
pnpm monorepo:check-links
PUBLIC_DEBUG=false \
EXTENSION_JAZZ_APP_ID=9c0871ad-3ea3-49d0-9eaf-b034914da924 \
EXTENSION_JAZZ_SERVER_URL=https://clipper.delightfullabs.com/jazz \
EXTENSION_WEB_URL=https://clipper.delightfullabs.com/ \
pnpm --filter @delightful-clipper/extension build
```

The unpacked candidate is `apps/clipper/apps/extension/dist`. Set all three
extension coordinates explicitly as above so local `.env` settings cannot select
another library. Do not distribute `.test-build`, which uses a fixture identity,
local backend and debug settings. Retain the exact source commit, manifest version,
archive SHA-256 and successful CI/browser evidence with each candidate.

Inspect the generated manifest, its entry files and bundled WASM. The manifest
must retain the existing public key, MV3 module background worker and permissions
`activeTab`, `scripting`, `storage`, `offscreen`. There are no persistent host
permissions or remotely loaded application scripts. Package the directory's
contents with `manifest.json` at the archive root; exclude credentials and browser
profiles. Keep the previous distributed package for rollback.

## Qualify the exact package

The migration's production package check is opt-in because it creates disposable
synthetic accounts and articles on the live backend. From the monorepo root:

```sh
pnpm --filter delightful-clipper exec node apps/extension/tooling/qualify-production.ts \
  /absolute/path/to/unpacked-candidate /absolute/path/to/result.json
```

It loads the supplied package into a fresh Chromium profile and uses the native
`Extensions.triggerAction` command for toolbar gestures. The only intercepted
content is a synthetic rendered article at `https://example.com/`; app, extension,
authentication and backend traffic are real. It checks trusted sign-in admission,
invalid recovery input, confirmed restoration, resumed capture, independent web
replication of rendered content, form-value exclusion, duplicate handling and
capture after a full browser-process restart. Recovery phrases remain in memory;
traces and credential screenshots are not collected. Profiles are removed on exit.
Results contain bounded, sanitized failures and public package metadata.

Use the Playwright Chromium version installed from the frozen lockfile, including
its extension-debugging support. If Chrome cannot start or requires user access
approval, stop and tell the user immediately so they can allow it. Do not treat a
permission block as an application failure or silently switch browser sessions.

The isolated CI extension suite remains the broader regression gate, including
its native offline scenarios. This production check does not qualify every browser,
platform, minimum supported version, offline race or store installation/update.
See the [qualification record](../../../specs/002-monorepo-agent-guidance/extension-release-handoff.json).

## Publication and follow-up

The migration package has not been uploaded or published. Before a store release,
confirm the intended store/listing and its current accepted manifest version.
Choose an appropriate higher version if required, rebuild and qualify that exact
artifact. Verify signing/listing ownership preserves the public extension identity;
a regenerated key creates a different installation identity. Store upload,
publication and any credential changes require scoped user authorization.

Store installation/update, the supported browser/OS matrix and minimum versions
remain separate release gates in the product plan. Keep source repositories and
previous release artifacts available until their handoff/retirement is explicitly
approved. This qualification does not close Finance draft PR #67 or change the
status of Clipper source PR #38.
