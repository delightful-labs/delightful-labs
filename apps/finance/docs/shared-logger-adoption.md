# Shared logger adoption

Finance's `src/lib/diagnostics/logger.ts` now delegates scoped output to
`delightful-local-first/diagnostics/logger`. Finance retains exact `PUBLIC_DEBUG === 'true'`
configuration and exports its existing `debugEnabled` and `createLogger(scope)` API. DebugValue is
re-exported from DLF. Diagnostic projections, redaction policy, inspector lifecycle and call sites
remain Finance responsibilities.

The shared module preserves `[scope] message`, structured details and gating of all three levels,
including errors. It adds no buffering, persistence, SDK instrumentation or remote export. Callers
must continue selecting non-sensitive fields; the logger does not sanitize arbitrary strings.

## Artifact provenance

- DLF PR: https://github.com/delightful-labs/delightful-local-first/pull/13
- Source commit: `aaf718d` (`feat(diagnostics): extract opt-in scoped logger`).
- Archive: `vendor/delightful-local-first-aaf718d-logger.tgz`.
- SHA-256: `140434cf6f93aaa5f7569f76e1d3bdd5f581ae939bde5c9ef4b824d1aafe7925`.

The archive is produced by DLF's checked package build and `pnpm pack`; the lockfile pins its
integrity. It replaces the previous finance-extraction archive. This updates to current DLF main plus
the logger, including already-merged profile field-ID/draft fixes, data-adapter simplification and
additional invitation entry points. The adoption introduces no new application use of those
invitation APIs. Profile unit/browser regression checks accompany the package update.

## Validation

The shared implementation was presented before the user requested Finance adoption and both PRs.
The existing Finance logger/debug-configuration, inspector, machine diagnostics and diagnostic
integration tests exercise the actual packaged logger through the unchanged wrapper API. Profile
unit/browser checks cover the package update. Source/service-worker and browser-test types and a
production preview build are checked separately. Exact results are recorded in the PR description.

No environment defaults, catalog source, diagnostic payload projections, SDK data ownership or
application persistence behavior is changed by the logger wrapper.
