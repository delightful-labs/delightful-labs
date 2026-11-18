# Delightful Clipper

A private, local-first web article reader and browser clipper. It supports URL and rendered-page capture, private saved readers, organization, recovery, offline reading and a Chromium extension. The web application and Jazz client run in a dedicated worker.

```sh
pnpm install --frozen-lockfile
pnpm clipper:verify
pnpm --filter delightful-clipper dev
```

Run these commands from the monorepo root using pnpm 10.28.0 and Node 24.22.2. See [tooling documentation](docs/tooling.md) for commands, archive provenance, CI and Vercel configuration.

- [MVP specification](specs/001-jazz-clipper/spec.md)
- [Chromium extension release](docs/extension-release.md)
- [Technical plan](specs/001-jazz-clipper/plan.md)
- [Investigation results](specs/001-jazz-clipper/investigation-results.md)
- [First implementation handoff](specs/001-jazz-clipper/implementation-handoff.md)

The previous prototype and isolated proof scripts are preserved on [archive/pre-jazz-rewrite-2026-11-02](https://github.com/delightful-labs/delightful-clipper/tree/archive/pre-jazz-rewrite-2026-11-02).

All changes use feature branches and pull requests targeting monorepo `master`.

## Vercel dependency installation

The web deployment installs with:

```sh
pnpm --filter '@delightful-clipper/web...' --filter delightful-clipper install --frozen-lockfile
```

This selects the web app, UI, Local First and the coordinator. Including the
coordinator preserves its existing preinstall checks; unrelated app preparation
and extension installation are excluded. Use the full workspace install above
for development and CI, including the extension fixtures used by web type checks.

## Jazz schema generation

Commit `schema.ts`, native migration definitions and schema snapshots. Jazz's
`jazz:generate` script validates them and produces the ignored
`apps/web/src/lib/backend/jazz/migrations/index.ts` runtime bundle. Web setup,
development, type checks and builds run this generation automatically; do not edit
or commit the generated bundle.

Development data is disposable. Test profiles created with the incompatible
optional-document annotation schema must be cleared before using the repaired
schema. Normal startup never silently deletes a database.

Saved state lives on Documents, which join to Article attachments and their reusable
Sites. Article owns title, parser excerpt, content and capture URL evidence. Notes,
tags and reading state use Document identity. Jazz provides creation metadata;
Clipper does not store a second saved timestamp. The installed alpha may adjust
its reported creation time by a millisecond as native writes reconcile.

The reader worker computes progress from viewport measurements. Required progress
starts at zero in every creation transaction. Native set merges retain the furthest
progress across offline replicas; resume position independently selects the latest
interaction Date. The private merge sets encode numeric observations as decimal strings
to avoid the installed SDK's FLOAT-set upload failure; the public value remains an exact
number. Preference history does not duplicate Document reading state.
