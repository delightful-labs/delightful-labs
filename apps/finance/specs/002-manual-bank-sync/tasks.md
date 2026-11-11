# Implementation tasks

- [x] Align plan, research, model, contract and quickstart with passkey specification.
- [x] Implement validated, scope-bound PRF encrypted credentials.
- [x] Add encrypted connection schema and owner permissions.
- [x] Add schema migrations and the mapping-to-connection relationship; verify dev-server deployment and workspace startup/reload without resetting data.
- [x] Add restricted SimpleFIN Bridge relay and provider adapter.
- [x] Add explicit XState connection/discovery/sync workflows and mapping UI.
- [x] Split setup into explanatory XState views with explicit encryption, unlocking, and final-save actions; hide the form while setup is active.
- [x] Default discovered accounts to adding a provider-named local account and mapping in one transaction; show optional existing-account mapping only when local accounts exist.
- [x] Add deterministic validated transaction import and outcomes.
- [x] Run formatting and type checks.
- [x] After implementation approval, add and run focused unit/Playwright coverage (34 unit tests and 4 Playwright tests; synthetic WebAuthn and mocked provider responses).
- [ ] Validate physical-device passkey compatibility and encrypted replication.

- [x] Add a standalone XState passkey demo accepting dummy text, without SimpleFIN requests, token validation, or finance writes.

## Environment-controlled bank demo

- [x] Add optional `PUBLIC_SIMPLEFIN_DEMO` (default false), simulated provider responses, and relay protection. Implementation awaiting review; tests not added or run.
- [x] After review, retain identical bank-page presentation, add opposite-mode connection guards, and remove standalone demo artifacts. Implementation awaiting review; tests not added or run.
- [ ] After review, update documentation and add/run approved unit and Playwright coverage for demo and real modes.

- [x] Add the DUI visual stepper to active bank setup, retaining existing workflow controls. Awaiting review; tests not added or run.

- [x] Refactor authorization and operation sequencing into XState states and expose the application-scoped actor, typed snapshot, status, and events through getBankSync(). Awaiting implementation review; no tests added or run.

- [x] Review the full bank integration and split workflows into focused machine files with smaller invoked actors, direct child authorization, state-driven import traversal, and inferred global actor types. Awaiting implementation review; no tests added or run.

- [x] Model neutral connection states, complete/partial success, cancellation, and specific failures as explicit ready substates; move presentation keys to state metadata and remove message/phase flags and forwarding events. Awaiting implementation review; no tests added or run.

- [x] Move remaining readiness, last-sync summary, scoped account/mapping data, status descriptors, and setup-step progression into the machine model; forward raw query observations and keep only translation/date formatting in presentation. Awaiting implementation review; no tests added or run.

- [x] Add an observable application-readiness parent actor owning the bank child, with explicit session and organization-membership states and a shared context API. Omit unobservable Jazz transport state. Awaiting implementation review; no tests added or run.

- [x] Replace setup/operation preparation promises with a shared preparation machine and invoked identity-check child; expose authorization decisions as guarded transitions with focused query/ID actors. Awaiting implementation review; no tests added or run.

- [x] Split account routing, creation, mapping, unlinking, and shared write validation into invoked machines; retain atomic conflict checks. Formatting and type checks pass. Awaiting implementation review; no tests added or run.

- [x] Decompose import traversal into account and transaction child machines with explicit omission, duplicate, imported, and failure outcomes. Awaiting implementation review; no tests added or run.

- [x] Model bank access, credential readiness, and sync-control visibility in an observable availability child and remove flag-based classification from observation/view helpers. Formatting and type checks pass. Awaiting implementation review; no tests added or run.

- [x] Move provider mapping status, eligible destinations, and mapping action availability from presentation into per-provider child actors. Awaiting implementation review; no tests added or run.

- [x] Unify operation classification, persisted sync outcomes, and parent results through explicit complete/partial/failed/cancelled states. Formatting and type checks pass. Awaiting implementation review; no tests added or run.

- [x] Move setup baseline checks and insert/update selection into child machines; remove duplicated Flow.stage lifecycle state. Formatting and type checks pass. Awaiting implementation review; no tests added or run.

- [x] Replace conditional saved-result projection with an observable history child containing absent/succeeded/partial/failed states. Formatting and type checks pass. Awaiting implementation review; no tests added or run.

- [x] Fix all five lifecycle review findings: cancel-before-stop, global startup/workspace ownership, machine-owned bank section visibility, typed setup outcomes, and reset/cancel precedence on child errors. Formatting and type checks pass. Awaiting implementation review; no tests added or run.

- [x] Reuse sidebar browser offline status to replace bank setup/reconnect controls with an availability message and disable both Sync now buttons with explanatory text. Awaiting implementation review.
- [x] After implementation approval, add and run focused offline setup and sync-control coverage: two Playwright tests pass for setup/idle-prompt hiding, centered 6rem icon, both disabled sync buttons and accessible explanations, reconnect setup, and connectivity restoration without automatic provider requests. Test TypeScript checks pass.

### Actor error-boundary follow-up (before account merge work resumes)

- [x] Move six bank-setup promise catch/rethrow classifications into their owning `onError` transitions. Preserve existing sanitized failure codes, diagnostic logging and terminal cleanup. Implementation reviewed and approved.
- [x] After setup implementation review, add/run focused setup failure and cleanup coverage. Eight unit tests pass: six classified failure boundaries, encrypted persistence through explicit steps, and cancellation with a late rejection. Assertions cover sanitized diagnostics, transient cleanup and lock release. TypeScript and formatting checks pass. No new browser behavior was added; existing Playwright workflows were not rerun in this focused unit-test cycle.
- [x] Move unlock/provider-fetch error classification into bank-operation `onError` transitions. Preserve sanitized `unlock_failure`/`provider_failure` results, the safe unlock diagnostic, existing failed-sync persistence, and secret cleanup. Implementation reviewed and approved.
- [x] After bank-operation implementation review, add/run focused failure-classification, cancellation and cleanup coverage. Eleven unit tests pass: discovery/sync failures at unlock/fetch, failed outcome recording, successful discovery/sync, and cancellation racing late success/rejection at both effect boundaries. Assertions cover classification, secret cleanup, lock release, no downstream import after cancellation/failure, and failed-sync persistence. TypeScript/format checks pass. No browser workflows rerun in this focused unit-test cycle.
- [x] Add `invoke.onError` to all four bank-setup lock invocations and the bank-operation lock invocation. Synchronous actor failures before acquisition follow the existing failure classification and terminal secret cleanup, without waiting for a failed lock actor. Preserve the callback's necessary asynchronous Web Lock rejection handler. Implementation reviewed and approved.
- [x] After lock-boundary implementation review, add/run focused actor-startup failure and cleanup coverage. Six regression cases pass: failed acquisition at each setup stage and for discovery/sync operations. Assertions cover secret cleanup, release of previously acquired locks only, and prevention of downstream effects. All 25 focused setup/operation tests pass, as do TypeScript/format checks.
- [x] Model unexpected startup/session-observer and workspace-bank child failures. Observer recovery waits for workspace/bank cleanup; failed actors are released without awaiting impossible acknowledgements. Bank availability/history/mapping errors use orderly shutdown. Organization selection is an invoked effect with a failure path. Late startup, stale workspace, and completed-setup notifications cannot interrupt cleanup. The user authorized completion and testing without further review pauses.
- [x] Verify the XState cleanup with 144 passing unit tests across 17 machine/integration/session files. Coverage includes classification and sanitization, acquisition failures, identity/authorization changes, mapping eligibility, import decisions and idempotency, partial-result persistence, readiness retries, cancellation/shutdown races, and journal write-policy guards. `pnpm check` reports zero errors and warnings; test TypeScript, focused Prettier, and diff checks pass.
- [x] Run eight passing Playwright checks against an isolated in-memory Jazz runtime: offline setup/controls, explicit connection/discovery/idempotent sync and provider failure, relay rejection, lock-start failure with explicit retry and no stale actor warnings, cancellation with actual late passkey completion, startup storage failure/retry, and native IndexedDB journal compare/write races, binding/discard conflict checks, abort settlement, and connection release. Replace obsolete standalone-demo tests with bank-page regressions. Rerun with `pnpm exec playwright test --config playwright.bank-sync.config.ts`. The account-merge migration implementation remains paused.

## Current deferred status (2026-10-24)

- [ ] Resume the paused account-merge implementation only as a separately reviewed feature; the spec/code repair cycle did not implement merging.
- [ ] Validate physical-device passkey compatibility and encrypted credential replication; synthetic WebAuthn coverage does not establish physical-device support.
- [ ] Design credential sharing, backup enrollment, or additional recovery mechanisms only if separately approved; organization membership does not grant credential decryption.

Intermediate “awaiting review/no tests run” notes above describe historical slices.
Later recorded actor and bank-page verification supersedes those notes for the
covered behavior. The independent-Check test run included all current unit tests,
but did not rerun the bank browser suite or establish the remaining demo/real-mode
and physical-device checks. Those outstanding verification tasks remain open.
