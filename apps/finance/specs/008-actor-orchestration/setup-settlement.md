# Setup persistence settlement: focused design

Scope: `bank-sync/setup.ts` and `bank-sync/setup-persist.ts`. No bank command or
presentation changes. Implementation review precedes tests.

Setup owns the saving-stage lock. Its persistence child owns one insert/update and
the local settlement wait. These are leaf effects: neither reads nor makes policy
decisions. The child chooses insert/update through guards before invoking the effect.
The SDK write handle's local wait has no abort-signal parameter; stopping a promise
does not establish rollback.

Model before effects:

- Existing authorization and baseline checks precede persistence.
- `saving.persisting` invokes persistence across `working` and `draining` substates.
- Cancellation enters `draining`, clears setup's transient material, and retains both
  persistence and the saving-stage lock until the child finishes.
- A lock failure during persistence enters `failing` and also awaits settlement;
  no new write or retry starts. Cancellation can supersede that failure, while a
  later failure cannot supersede cancellation.
- Persistence reports `locallyPersisted` or `unresolved`; rejection does not claim
  rollback. Cancellation output retains that settlement fact.
- A failed/completed persistence child is handled by invocation error/output, without
  requesting an acknowledgement from it. Late completion cannot undo draining intent.
- Cancellation before persistence still aborts ordinary work without issuing a write.
- Saving already suppresses credential-fingerprint notifications because its own
  optimistic connection write changes that fingerprint. Retain that behavior in this
  focused change; existing authorization/baseline checks remain before the write.
  Identity/workspace replacement still arrives through the parent's cancellation path.

No new async orchestration is introduced. `connectionValues` only transforms encrypted
input, and insert/update each issue one write and await its settlement. Terminal setup
cleanup clears token, credential material, plaintext Access URL and preparation data.

Implementation reviewed and approved before tests. Only these two production files
changed. D002 remains incomplete because mapping, operation/import draining and
availability reporting are separate review cycles.

## Verification

- 28 relevant unit tests passed across `setup.test.ts`, `setup-persist.test.ts` and
  `index.test.ts`. Pending write tests verify cancellation waits, transient cleanup,
  lock retention/release, successful/unresolved settlement, lock failure and child
  failure. Persistence tests cover insert/update outcomes and sanitized errors.
- Three existing Playwright checks passed: explicit connection/account creation/import,
  lock startup failure/recovery, and cancelled passkey creation with late completion.
  Two existing status locators were narrowed to the expected message after they matched
  both the bank message and an empty screen-reader status element.
- `pnpm check`, `pnpm check:tests`, focused Prettier checks and `git diff --check` passed.

Commands:

```sh
pnpm exec vitest run src/lib/machines/bank-sync/setup.test.ts src/lib/machines/bank-sync/setup-persist.test.ts
pnpm exec vitest run src/lib/machines/bank-sync/index.test.ts
pnpm check
pnpm check:tests
pnpm dev:agent --host 127.0.0.1 --strictPort
pnpm exec playwright test --config playwright.bank-sync.config.ts tests/bank-sync.e2e.ts --grep 'connects explicitly|lock actor startup failure|cancelled passkey creation'
```

Evidence limits: pending local settlement is controlled at the actor effect boundary
in unit tests; no browser database-settlement delay hook was introduced. Browser checks
exercise the real local database and existing visible setup/cancellation flows. This
does not verify mapping/import draining or the full application/PWA suite.
