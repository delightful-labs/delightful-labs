# Recovery Slice Research and Decisions

**Date**: 2026-10-31 | **Status**: source-backed design proposal, no runtime verification

## Evidence Baselines

Finance checkout `8ff72f6`; DUI checkout `9bc5405`; Local First tooling commit `a34d642`.
Finance's worktree has no installed packages. Matching Jazz alpha.59 and Paraglide 2.27.0 source
were read from `/Users/matthewjamesderocher/Projects/delightful-finances/node_modules/` without
modification. No consumer server, compiler experiment, or implementation test was run.

## 1. Extract the Existing Recovery Seam

**Decision**: Reuse Finance's separation of machine, integration, contract, and DUI view, with
library-owned names and no Finance imports. Finance remains the session owner.

**Evidence**: Finance `src/lib/components/identity/RecoveryPhraseIntegration.svelte` reads the
existing `getJazzSession()` store, owns an actor and view subscription, sends identity observations,
and shuts the actor down before stop. `src/lib/machines/identity/recovery-phrase.ts` owns reveal,
confirmation, failure, hide, and shutdown. `src/routes/account/+page.svelte` mounts it once.

**Changes needed during extraction**: Replace fixed DOM IDs with instance-safe IDs. Check eligibility
on every retry rather than copying the existing failed → revealing transition that skips the first
availability guard. Keep SDK handles outside actor input/context; use non-secret scope tokens.

**Alternatives**: A new session provider would compete with Finance ownership. A whole account-page
extraction would pull in unrelated profile/login behavior. Both are rejected for the first slice.

## 2. Reveal Is a Local Leaf Operation

**Decision**: Model disclosure and its lifecycle as a machine; keep export plus deterministic phrase
conversion as one local, resource-free leaf with an adjacent binding recheck. Do not invent a remote
request, database transaction, or session bootstrap for reveal.

**Evidence**: Jazz alpha.59 `dist/accounts/enrollment.js` exports the local-first root only for a
retained `urn:jazz:local-first` handle and otherwise throws `local_first_recovery_unavailable`.
`dist/runtime/recovery-phrase.js` converts it synchronously with the English BIP39 word list.
`dist/svelte/session-state.js` reads existing provider context; the adapter need not call it itself.

The export lookup uses a module-private WeakMap. A handle from another physical Jazz module copy
can fail even at the same version. Use a peer/external adapter dependency and verify the packaged
Finance integration; do not bundle Jazz. Future identity providers may be unavailable for this slice.

**Alternatives**: Copying SDK internals, passing raw root secrets as props, or creating a new account
manager would expand authority and coupling. Unsupported handles report unavailable/failure without
fallback to another identity or new credential creation.

## 3. Library-Owned Messages, Explicit Locale

**Decision**: Pin Paraglide 2.27.0 for initial implementation; compile the library's own recovery
catalog with declarations before checks/package/Storybook. Keep generated modules private, use
ordinary unspecialized message output, and pass explicit locale options to every generated call.

**Evidence**: Finance declares `^2.18.2` but resolves **2.27.0** in its lockfile. Its inlang project
supports English only, with separate main/photo-cropper/image-editor catalog patterns. Installed
`dist/compiler/compile-bundle.js` selects static locale first, then `options.locale`, then
`getLocale()`. Generated Finance calls accept a typed explicit locale argument. Static/per-locale
specialization must not override the library's explicit locale strategy.

Expose a narrow English message factory with typed partial wording overrides and accept a complete
`RecoveryMessages` object for other consumer translations. English is the only initially bundled
locale. Do not silently mix English defaults into a purported non-English catalog. The host resolves
locale per request/component and recomputes text reactively without recreating the recovery actor.
No library `setLocale`, global store/getter override, cookies, URL strategy, middleware, or routing.
Finance's warning mentions finances; library default wording must be domain-neutral and retain the
credential-authority warning. Finance may override its copy through the public text contract.

Generated JS/declarations are included in the built package, compiled and type-checked, but excluded
from authored-code style restrictions that conflict with compiler output. The consumer never imports
the library's generated keys/runtime. No message compiler dependency is required at consumer runtime.

**Alternatives**: Importing Finance's generated module breaks reuse. Requiring catalog merges into
each consumer build couples app tooling. A shared global locale introduces SSR/cross-instance state.
Passing only complete text is supported, but alone would omit the useful library-owned default catalog.

Primary context: [Paraglide basics](https://paraglidejs.com/basics) and
[compilation](https://paraglidejs.com/compiling-messages). Current docs may describe newer behavior;
installed 2.27.0 source is the evidence for the specific locale selection above.

## 4. Privacy Applies to Diagnostics and Fixtures

**Decision**: No raw actor inspection/snapshot persistence hook in the owned recovery composition.
Keep phrase out of events sent to host observers, diagnostics, URLs, storage, and real-account browser
artifacts. Library code releases references; it cannot promise reliable zeroing of JavaScript strings.

**Evidence**: Finance's integration attaches its general inspector. The phrase appears in machine
context and promise completion output, so copying the hook requires more than a label warning.
Finance's browser base configuration retains traces/screenshots on failure; avoiding secret values
in assertions alone does not protect captured DOM. Synthetic Storybook fixtures can retain ordinary
artifacts; actual account recovery checks need traces, screenshots, and video disabled.

**Alternatives**: Building a new generic sanitization/inspection framework is outside this slice.
Only non-secret outcome codes may be reported; custom advanced workflow consumers must treat the
machine and all snapshots/events as sensitive.

Primary context: [XState promise actors](https://stately.ai/docs/promise-actors) and
[invocation](https://stately.ai/docs/invoke). Exiting invocation discards late results; it does not
prove an underlying effect was cancelled or a string erased.

## 5. Use Existing DUI Behavior

**Decision**: Reuse Finance's exact DUI archive initially. Native modal behavior, caller labels,
per-instance IDs, checkbox acknowledgement, local layout, and one feedback region are sufficient.
No new DUI primitive, global theme import, QR display, clipboard operation, or visual redesign.

**Evidence**: DUI Dialog handles modal state/native close events; Textarea and Checkbox accept
caller labels/IDs and native attributes. Current checkout has ButtonContent, but Finance's archived
artifact may differ. The first slice does not require that newer primitive.

**Remaining verification**: Installed source inspection establishes proposed mechanisms, not package
qualification. Implementation must verify generated locale calls, exported subpaths, same-module Jazz
resolution, teardown races, focus, and continued Finance usability under its actual dependencies.
