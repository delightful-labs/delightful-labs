# Workspace validation

Read [spec.md](spec.md) for product behavior, [plan.md](plan.md) for current architecture, and the
[operation contract](contracts/workspace-creation.md) for navigation and recovery behavior.
Follow the repository implementation-review gate before adding/running tests for a new change.

Finish static/unit generation before starting browser tests: both regenerate shared environment files.

```sh
pnpm check
pnpm check:tests
pnpm exec vitest run src/lib/machines/workspace-creation-operation.test.ts src/lib/machines/workspace-creation.test.ts src/lib/machines/workspace-creation-persistence.test.ts src/lib/machines/workspace-creation-reconciliation.test.ts src/lib/machines/workspace-creation-transaction.test.ts src/lib/machines/workspace-initialization.test.ts src/lib/machines/workspace-startup.test.ts src/lib/machines/workspace-navigation.test.ts src/lib/machines/workspace-integrity-assessment.test.ts src/lib/machines/workspace-integrity-transaction.test.ts src/lib/machines/workspace-integrity.test.ts src/lib/machines/workspace-integrity-owner.test.ts src/lib/machines/readiness.test.ts
pnpm exec playwright test --config playwright.multiple-workspaces.config.ts
pnpm exec playwright test --config playwright.workspace.config.ts
```

The browser configs start `pnpm dev:agent` at http://localhost:5180 with disposable in-memory Jazz.
Announce the URL first. Do not reset, stop or reuse persistent development data on 5173/5174.
Run only the cases relevant to a focused change; the commands above are the broader workspace suites.

Coverage includes duplicate names; one shared selector/switch command; independent query scope,
history and reload; input discard/filter reset; accessible creation progress; warm-offline creation;
journal recovery without replay; original-ID retry; missing-marker rejection without backfill;
profile-only integrity repair; lost membership without resurrection; and current server authorization.
Follow-up cleanup checks passed their targeted suites, not a final full application/PWA rerun.

Production compilation and shell/offline checks use `pnpm build` and `playwright.pwa.config.ts` with
a disposable Jazz server. Follow that config's preview setup; a build without a reachable Jazz URL
proves compilation only, not fresh-identity runtime behavior. Builds/tests do not deploy migrations.
Local success means local durability; server-policy assertions require authoritative reads/waits.
