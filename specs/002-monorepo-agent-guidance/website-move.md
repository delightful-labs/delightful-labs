# Slice 1: website workspace foundation

## Source, scope and history

Source: `delightful-labs/delightful-labs`, commit
`c75d672f231e8d6e7087454431b80496dc353c67`. Destination: this feature branch.
This is a move within the same repository; original commits remain reachable
through existing ancestry. For example, `git show c75d672:src/routes/+page.svelte`
locates the original homepage. No source-of-truth handoff or release has occurred.
Other repositories, their open branches/PRs/issues and integrations remain there.

| Original path | Workspace path |
| --- | --- |
| `src`, `static`, `tests`, `vendor` | `apps/website/` plus original path |
| `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, `vercel.json`, `.env.example` | `apps/website/` plus original path |
| `scripts/verify-build.mjs`, `scripts/verify-native.mjs` | `apps/website/scripts/` plus original filename |
| `specs/001-homepage-native-blog` | `apps/website/specs/001-homepage-native-blog` |
| Website `README.md`, product guidance and app package | `apps/website/README.md`, `AGENTS.md`, `package.json` |
| Lockfile, CI, reusable Spec Kit skills/helpers/templates | Retained at root |
| Monorepo feature and selector | Retained at root |

Excluded: generated output, dependency installs, local environment files and
browser artifacts. The existing source checkout and its local files are untouched.
The root package is private orchestration; the website retains package name
`delightful-labs` and all original app commands, dependency versions and imports.
The root `pnpm exec playwright` CI command becomes
`pnpm --filter delightful-labs exec playwright`; existing job identity and checks
are preserved. No additional task orchestrator, dependency or release pipeline.

## Website guidance disposition

Provenance for every row: original `AGENTS.md` at the source commit above.
These dispositions apply only to the website slice. Other source rules are not
reconciled or replaced by this move.

| Original rule/topic | Disposition and authoritative location | Reason |
| --- | --- | --- |
| Svelte and DUI foundation | Local: website `AGENTS.md` | Website framework requirement |
| Content restraint, native blog preservation, no fixtures in public content | Local: website `AGENTS.md` | Product scope |
| Authorized compact app embeds | Local: website `AGENTS.md` | Homepage authorization |
| Authorized grayscale portrait and fallbacks | Local: website `AGENTS.md` | Homepage authorization |
| Typography ownership and defaults | Local: website `AGENTS.md` | Existing website constraint, no broader policy inferred |
| Native AT Protocol record rendering | Local: website `AGENTS.md` | Website publishing architecture |
| Vercel target | Local: website `AGENTS.md` | Does not select hosting for sibling apps |
| Network servers, URLs and distinct ports | Shared: root `AGENTS.md` | Matches current user instructions; app inherits root rule |
| Active feature lookup and Spec Kit helper discovery | Scoped selectors, shared helper links | Keeps project feature writes independent without duplicating reusable tooling |
| No ratified constitution | Root `AGENTS.md` | Template is not adopted as policy |
| Initial foundation/native-reader next-step text | Superseded by website feature records | Completed-phase text must not restart completed work; original remains in history |
| Publication/archive/DNS integration gates and deferred content/typography | Local: website `AGENTS.md` | Approval requirements remain effective |

Root guidance routes task topics to project guidance; it does not activate the
unreconciled Finance/Clipper/library policies. App `.specify/scripts` and
`.specify/templates` link to the single maintained root copies. Project-local
`feature.json`, `init-options.json` and `integration.json` are scoped state/config,
not duplicate reusable templates. Skills stay under root `.agents/skills`.

## Verification and commands

Baseline under Node 24.22.2 / pnpm 10.28.0 before moving:
`pnpm check` (zero errors/warnings), `pnpm test` (152 passing), `pnpm build` and
`pnpm test:build` passed. Baseline used an isolated copy of the existing install.

After moving, a frozen install succeeded with 227 packages (226 reused, one
existing locked package downloaded). No dependency resolution/version changes;
the lockfile diff only relocates the importer and UI archive paths. An offline
attempt first identified the missing cached `dequal` archive; the subsequent
normal frozen install completed successfully.

Root delegation checks passed: `pnpm check` (zero errors/warnings), `pnpm test`
(152 passing), `pnpm build`, and `pnpm test:build`. The emitted server checks
exercise homepage/writing responses, unknown article and removed archive 404s,
feed aliases, sitemap and all six legacy redirects. A byte comparison against the
source commit verified all moved source, static assets, tests, scripts, configs,
archive, website README and feature documents unchanged.

All six existing Playwright Chromium checks passed against the relocated review
server: homepage embeds/native writing navigation, unknown article 404, mobile
and keyboard navigation, portrait pause/resume, reduced motion and WebGL fallback.
No tests were added or changed. The review server listens on `0.0.0.0:5185`.

Spec Kit `check-prerequisites.sh --json --paths-only` from root resolves
`specs/002-monorepo-agent-guidance`; from `apps/website` it resolves
`specs/001-homepage-native-blog`. No sibling selector was changed. For an explicit
root invocation targeting website, use:

```sh
SPECIFY_INIT_DIR="$PWD/apps/website" bash .specify/scripts/bash/check-prerequisites.sh --json --paths-only
```

## Deployment continuity and remaining gate

The Vercel adapter and app `vercel.json` are unchanged. Build output is
`apps/website/.vercel/output`; the current `.vercel` project link is not copied
from another checkout. For hosted verification, the existing website project
needs Root Directory `apps/website` and access to the root workspace files. Build
and frozen-install commands remain app commands. Retain the project identity,
Node 24 runtime, domains, production branch, environment scopes, Blob store and
rollback deployment. No hosted setting, environment value, DNS record or release
was changed in this slice.

A successful local adapter build is not hosted preview evidence. Before accepting
source handoff, configure/verify the app root in an isolated preview and verify
native content, existing redirects, assets and environment separation there.
Keep the prior maintained source/deployment available until that gate passes.

## Rollback

Before merge, discard or revert only this slice on the feature branch; original
source is available at the source commit. After a reviewed merge, revert the move
and its workspace/CI/guidance changes together, regenerate the prior frozen
install, and restore the previous hosted root setting if it was changed. If a
release occurred, restore the previous known deployment through the existing
project's rollback path. Do not reset user work or remove another project's data.
