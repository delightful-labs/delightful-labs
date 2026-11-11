# Finance foundation extraction

The `feat/finance-foundation-extraction` branch adopts the remaining reusable behavior that already
existed in Finance. New collaboration features remain a later library phase. The local vendored
artifact is `delightful-local-first-0.0.0-finance-extraction.tgz`; superseded archives are removed.

## Adopted boundaries

- Scoped contracts, readiness, validation/submission, persistence/drain, dirty/reset/edit ownership,
  Svelte attachment and actor shutdown now come from library `forms/*` exports. Finance's adapters
  retain Zod schemas, issue normalization, existing render-time Paraglide callbacks and diagnostics.
- Form content/feedback/modal and profile name/avatar presentation come from shared compositions.
  Finance supplies existing strings/icons and its cropper snippet; no locale catalog or generated
  Paraglide source changes are needed. The existing DUI global CSS remains application-owned.
- Foreground `QuerySubscription`/`QuerySubscriptionOne` imports now use the named Jazz data boundary,
  which explicitly defaults to LocalFirst and preserves caller-supplied tiers. Native query building,
  schema expressions and subscription lifetime remain in pages/integrations. Row snapshots come
  from `data/observations`; issue/local-settlement helpers are used by atomic workspace naming.
- First-workspace initialization/provenance and startup/optional-seed coordination use shared
  machines. Supplied native discovery and starter-bundle preparation retain Finance's deterministic
  IDs, permissions and financial defaults. Local known provenance does not await authority.
- Explicit workspace creation delegates ownership, journaling, attempt recovery and prewrite
  reconciliation/transaction sequencing to shared machines. The durable journal keeps its existing
  database/store/version and strict payload schema. Retry never silently replaces an uncertain write.
- Profile name/avatar policy, image-resource/write ownership, explicit restoration/drain/navigation
  coordination and lazy Jazz application-lifetime acquisition are shared. Finance supplies its
  existing image processor, native persistence, browser guard and financial-resource drain protocol.

## Deliberate Finance integration

The library does not own `app` schemas, permission expressions or Zod financial validation. Account,
transaction, category/tag, transfer, bank-sync, credential, attachment and report operations remain
Finance-specific. Profile/workspace native mapping and starter categories remain here so the library
does not impose Finance's model on another app.

`workspace-creation-reconciliation` verifies Finance's complete organization/member/system-category
bundle; `workspace-creation-transaction` and `workspace-additional-creation-transaction` map that
bundle to native atomic writes. Generic transaction acquisition/settlement/cleanup is already shared.
`workspace-integrity*` repairs Finance's legacy profile/member attribution under its exact native
role/account-access policy; this schema migration is not a prerequisite for a new app. Runtime
readiness composes selected ledger/bank resources and route navigation; it is the app lifecycle owner,
not a second implementation of shared session/selection/initialization/form workflows.

Direct SDK imports retained here are schema/query/permission definitions, native transaction/storage
adapters, explicit authority/integrity/acquisition paths, the app integration's getDb/session context,
and type-only adapter signatures. They are intentional native v1 integration points, not claims of
portable schemas. Ordinary foreground subscriptions now enter through the named library boundary.
Do not replace deliberate authority reads with LocalFirst or add remote preflights to local use.

## Future changes

Use the existing Finance adapters when adding app-specific validation or policy. Change generic
workflow statecharts in the library and refresh the vendored archive; do not fork them back into
Finance. Follow the library's `docs/next-app.md` recipe for another app. Caller-supplied async
capabilities must still pass the recursive machine-first review: one leaf effect per promise actor;
read/check/write decisions and acquired-resource cleanup belong in statecharts.

Verification results are recorded in the library extraction audit after the final checks complete.

## Qualification (2026-11-02)

Finance's 1,761 unit tests pass against the extracted workflows. The final registry adoption passes
its five binding tests; final source/test types pass with zero Svelte errors or warnings. All 16
focused form/profile/recovery/naming browser checks pass. Of 73 workspace browser scenarios, 72
passed initially; an account-form scenario exposed a test helper returning before async workspace
selection finished. The helper now awaits the requested workspace URL and selector value; that
scenario passes without changing its assertions or timeout.

Both final production cold-client-exit scenarios pass: offline and an open remote connection that
never answers. Local records and saves remain usable; acknowledged settings/selection survive a
second complete client shutdown and reopen. The generated Paraglide tree is byte-identical between
this checkout and the isolated verification checkout. The library also passes 331 unit tests, strict
static/package/public-consumer checks and the Storybook build. See its extraction audit for details.
