# XState v6 implementation review

Status: implementation merged in PR #37 on 2026-11-09. Behavioral qualification in progress.
PR: https://github.com/delightful-labs/delightful-local-first/pull/37

## Versions and baseline

Source baseline: main `be40b8fd1e7e417ac447b45cd81437a407634675`.
Runtime and optional peer: `xstate@6.0.0-beta.1`. Migration tooling:
`@xstate/codemod@0.1.0-beta.1`, followed by manual generic-contract and runtime
semantics review. The v5 baseline remains available in Git; no behavioral baseline
was executed in this implementation phase. Jazz remains `2.0.0-alpha.59`.

## Changes for review

- Production forms, identity/session, workspace and backup machines use schemas,
  function transitions, immutable context patches and queued effects. Async and
  native callback leaves use the v6 logic factories. Generic output/input
  contracts are explicit where the codemod lost their inference.
- Sources use direct logic and `createInvoke` for generic inference. The form
  writer deliberately retains a registered v6 source for its native/consumer
  logic union. Its input cannot be inferred through the direct-source union.
- Final-state cleanup and outcome selection use their owning final entries.
  The deeper review corrected the earlier assumption that these entries were
  unsupported; the unnecessary incoming-transition wrappers have been removed.
  Parallel region cancellation, sibling reentry and effect order require replay
  qualification; static typing does not prove equivalent scheduling.
- Startup uses scoped child references. Writer failure uses the reported error
  rather than reading a completed child. Observer failure uses the stable
  lifecycle event category and actor identity.
- Transaction custody keeps receipt bookkeeping in a private closure behind a
  frozen interface. Retention, late acquisition and owner-error observation
  remain in place pending v6 native qualification.

## Unpatched XState and context ownership

Use the published `xstate@6.0.0-beta.1` package. There are no XState patches,
declaration overrides, or consumer patch requirements.

Related generic lifecycle values now live in explicit immutable records:

| Machine                     | Context record | Owned values                                    |
| --------------------------- | -------------- | ----------------------------------------------- |
| Session acquisition/startup | `acquisition`  | Session reference                               |
| Creation operation          | `operation`    | Binding, database, journal record               |
| Creation owner              | `bindingState` | Observed/active bindings, journal record        |
| Creation persistence        | `resources`    | Database, validated attempt                     |
| Creation transaction        | `resources`    | Transaction, records, workspace, commit receipt |
| Workspace initialization    | `operation`    | Database, prepared attempt, outcome             |
| Invitation authority        | `resources`    | Credentials, transaction, write receipt         |
| Workspace journal           | `observation`  | Parsed journal record                           |
| Workspace startup           | `results`      | Initialization and seed outcomes                |

Transitions replace a complete record, preserving its other members explicitly.
This works with the beta's context compatibility checks without weakening types.
Required secrets/resource clearing targets the same values inside their owning
record. The session selector retains its public return contract; callers must
adapt any direct access to these internal snapshot context fields. Persisted
XState snapshots from the prior shape are not a supported migration format.

Workspace initialization omits the generic union output schema and declares the
output mapper's `InitializationOutcome<Persistence>` return type instead. XState
infers the machine output from that mapper using its supported config inference.
The public input/event/output contracts remain typed; no casts or broad actor
types are introduced to bypass the published declarations.

The vendored DUI archive is unchanged. Its independent UI actors and consumer
archives still require coordinated v6 adoption; do not pass v5 actor refs or
logic into these v6 graphs. Finance's UI/worker split and Clipper Jazz patch
qualification remain consumer work under the migration specification.

## Validation and next gate

`check:library` checks production TypeScript and Svelte sources, excluding test
files. Packaging uses the same production configuration. This is an intermediate
validation boundary, not a replacement for the existing full `check` or `verify`.

Completed checks: `pnpm check:library` (zero Svelte errors/warnings and passing
production TypeScript), changed-source Oxlint with denied warnings, Oxfmt,
`git diff --check`, and `pnpm package` including strict Publint.

Before PR #37 merged, implementation tests and legacy fixtures were not migrated
or run because of the repository review gate. Those implementation commits used
`[skip ci]` to avoid running tests before approval. The merge clears that gate for
the merged implementation; post-merge qualification is recorded below.

Qualification checklist:

1. Migrate v5 test harnesses and fixtures, capture v5 traces from the baseline and
   compare v6 branch, cancellation, generation and terminal-output behavior.
2. Qualify parallel-region reentry/joins, secret clearing, late acquisition,
   issued writes, native disposal, custody after owner errors and uncertain
   settlement. Retain recovery ownership until each boundary is proven.
3. Run full checks, packaged consumer declarations/imports, native backup/Jazz
   fixtures and Storybook/browser flows. Verify optional independent subpaths
   without XState and an actual consumer installation using the published beta.
4. Build identifiable archives and qualify Clipper/Finance adoption separately,
   including worker storage identity, offline restart, multi-tab and drain.

No runtime-equivalence, browser, native, worker or downstream readiness claim is
made by the production type check or package build.

## Documentation-led design review

See [the source audit and cross-repository acceptance criteria](xstate-v6-design-review.md).
It records the corrected final-state interpretation, pure release-token updates,
queued native preparation, explicit choice nodes, private event origins, typed
observer children and the journal request typestate. Behavioral qualification
is in progress after merge; earlier static results do not qualify these changes.

## Post-merge qualification: session readiness

PR #37 merged at `73de2bc`; the user's merge confirmation clears the
implementation-test review gate for that merged code. The initial readiness slice changed no
production implementation; CI qualification below expands that scope. The 25 existing readiness tests now use
`createCallbackLogic` and the v6 `xstate.error.actor` protocol. Two deliberate
system-event injections remain outside the public command union, with localized
`@ts-expect-error` annotations. These check error-report handling, not an actual
child crash; native observer read/setup/cleanup failures are exercised separately.

`pnpm test:xstate-readiness` type-checks the two readiness test files and runs 27
tests, including two `@xstate/test` campaigns against the production actor. The
independent bound-observer contract compares status history, lifecycle and release
count. It generates all five session statuses, foreign attachment and noncurrent
observation reports, and shutdown. Shutdown also invokes a retained backend
callback to verify it cannot publish after disposal. The property campaign uses
seed `20261109`, 250 runs and up to 50 commands; it requires every command type and
model state. Shortest paths stop after three statuses and use an exploration limit
of 500, requiring all model states. Terminal shutdown ends a generated sequence.
The existing suite retains retry, duplicate, failure and drain scenarios.

`tsconfig.xstate-tests.json` is an incremental qualification target, not a
replacement for the full check. Remaining legacy harnesses, native backup,
packaged-consumer and browser/worker qualification are still outstanding. Generated
shrunk failures are ignored locally and uploaded by CI on failure; promote fixed
regressions to tracked replay fixtures as described in the design review.

Validation of this slice: focused strict TypeScript and all 27 tests pass;
changed-test Oxlint passes with denied warnings. Full `pnpm check` remains blocked
by 184 errors in 22 other legacy test/consumer files. CI runs the focused target
before the full check, and retains the full gate. This is not a green repository
qualification or release-readiness claim.

## PR #38 CI follow-up: implementation review required

The failing Actions run `42644545685` stopped at the full `pnpm check`, with 184
v5 harness errors. Remaining TypeScript and JavaScript fixtures now use v6
schemas, function transitions, async/callback/step logic and transition inspection.
Step-based report collectors ignore initialization; generic fake children retain
complete immutable context records and their exact public event contracts.
Fault-injection wrappers preserve the real machine lifecycle and throw at the
selected transition, replacing overrides of v5 actions that no longer exist.
No XState package, declaration, or required CI gate is patched or disabled.

Runtime checks against the already merged implementation exposed six production
corrections prepared in this follow-up:

- `workspaces/creation-owner.ts`: invoke input captures the admitted binding;
  the operation binding is recorded by entry, which runs after input selection.
- `forms/write.ts`: the assessment token uses the next generation; entry increments
  the owner's counter after invoke input is selected.
- `identity/session-recovery.ts`, `workspaces/invitation-authority.ts` and
  `workspaces/invitation-redemption.ts`: registered source names preserve supported
  `provide({ actors })` replacement behavior at these customization boundaries.
- `backup/restore-write-step.ts`: successful settlement/rollback enters a native
  custody-clear state while the custodian is still alive. A synchronous callback
  reports completion before the machine exits and stops its custodian. This avoids
  handing an already settled transaction to detached recovery. It adds no Promise
  or await to the transaction path and keeps uncertain/error custody intact.

Static validation passes: full `pnpm check`, library check, test-app/native-capture/
private-creation/packaged-consumer TypeScript, strict package validation, lint,
formatting and whitespace checks. The post-fix runtime, native and browser suites
are **not yet qualified**. The repository's explicit implementation-test review
gate applies to these new production corrections. The follow-up commit uses
`[skip ci]` until the user approves this concrete implementation; the full CI
workflow remains enabled and unchanged in scope. After approval, run the full
suite, address any further behavior differences, and rerun CI before merging.
