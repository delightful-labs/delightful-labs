# Shared scoped logger

Status: shared logger implementation approved through the user request for Finance adoption and
paired PRs. Six logger tests, public consumer checks and full library verification pass. Finance
adoption is in progress on its own feature branch. The user requested extraction after PR #12 merged, before the
architecture follow-up fixes.

## Source and responsibility

Finance main `7ccebf8` was checked after refreshing its remote reference; this worktree's detached
`f83be67` checkout is older. The logger is unchanged between those revisions.
Finance's `src/lib/diagnostics/logger.ts` supplies DebugValue, scoped info/warn/error methods,
structured details and explicit debug gating. Its `$app/env/public` import and PUBLIC_DEBUG default
are application configuration. Its logger tests establish exact lowercase `true` gating independent
of development mode. The DLF extraction retains the logging behavior while taking enablement and an
optional output sink as inputs; each host retains flag parsing and environment/build defaults.

The new `diagnostics/logger` package entry has no Jazz, XState, Svelte, application environment or
third-party dependency. It is synchronous output, with no multi-step workflow or acquired resource,
so a statechart is not warranted. It has no module/global logger registry, buffer, persistence,
subscriber, remote exporter or automatic SDK/actor instrumentation. Jazz continues to own its
runtime telemetry and connection/transaction diagnostics.

Each logger captures its scope, enabled boolean and optional sink. Default disabled applies to all
levels, matching Finance's current error gating. The optional sink supports console-compatible
info/warn/error methods and receives the original structured details. Sink exceptions propagate,
matching direct console delegation; an observing integration must contain its own diagnostics errors.
No claim of payload sanitization or automatic redaction is made. Existing source warning about
credentials, records, provider payloads, URLs and raw errors remains part of the usage contract.

## Implementation review and later coverage

The implementation is one source module, one package export and focused integration documentation.
Static source, format/lint, package/declaration and strict publint checks should qualify this batch.
After implementation approval, add meaningful coverage for default silence, explicit enabled and
disabled levels, exact prefix/details, per-instance isolation, injected sink receiver/exception
behavior and environment-free built imports. Public consumer fixtures should resolve the new subpath.
Do not infer approval of those new tests from Finance's older tests.

Finance adoption is a separate review: retain its PUBLIC_DEBUG parsing and existing createLogger
call sites through a thin import wrapper; update its pinned DLF archive only after package coverage.
Its existing logger tests and debug configuration tests are the affected checks. No new diagnostics
should be added to Finance or sensitive DLF actors merely because this logger exists.

## Further reuse candidates from inspected Finance sources

1. **Already shared; no new extraction.** Current Finance main's `runtime/actor-lifecycle.ts`
   re-exports DLF's `forms/lifecycle`, and `runtime/observations.ts` re-exports `data/observations`.
   The older detached worktree contains copies; it must not be used to infer that another
   extraction or adoption is still needed.
2. **Actor diagnostics projection, then optional inspector transport.** Finance's
   `diagnostics/machine-diagnostics.ts` and `diagnostics/inspector.ts` provide outcome projection,
   payload omission and an explicitly owned Stately connection. These are potential DLF diagnostics
   modules after policy review, not part of the basic logger. Separate Finance-specific field names,
   app session facts and build/HMR/environment configuration; never generalize regex redaction into
   a guarantee that arbitrary context/error text is safe. Preserve disabled behavior and sensitive
   actor exclusion. Stately's transport should remain an optional dependency.
3. **PWA update coordination.** Finance's `machines/pwa/pwa-update.ts` has injected registration,
   observation, activation and reload leaves. Its statechart can be reused after confirming host
   protocol and in-flight data/resource drain. The service worker, cache policy, deployment versions
   and UI/localization remain host/DUI responsibilities. This coordinates browser lifecycle, not
   Jazz synchronization, and must not become another offline data store.
4. **Image processing resource ownership.** Finance's `machines/images/image-processing.ts` and
   `domain/image-processing.ts` separate workflow from decode/resize/encode/release leaves. Reuse the
   resource-owning statechart only after settling DUI/platform ownership; keep cropper presentation
   and generic image primitives in DUI, SDK byte persistence in Jazz, and attachment rules in the app.
   Do not add Pica or copy this stack into DLF solely for one consumer.

Money/currency, financial dates/defaults, balance calculations, bank/provider synchronization,
transaction/transfer policy, starter data and app routes remain Finance-owned. Small helpers such as
`todayDateOnly` do not justify a new shared module without actual cross-app use. The existing
architecture tasks remain open; this extraction does not replace or resolve them.

Source TypeScript/Svelte checks pass with zero errors/warnings. Focused lint/format, package build
and strict publint pass. After implementation review the user requested Finance adoption and PRs. All 474 library unit tests
(including six logger cases), built-consumer types/runtime/build, and Storybook build pass. Finance
retains its existing wrapper API and exact debug-flag parsing while adopting the shared implementation.
