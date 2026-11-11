# Workspace naming: operation boundary first

Branches feat/workspace-naming start at library main 85233b1 and Finance main d98ef4c.
First review: actor-free contracts, a finite naming operation, and narrow package entry points.
No Finance implementation or UI migration is included until this boundary is reviewed.

## Evidence and responsibility

Finance's workspace settings form saves name and defaultCurrency in one db.update followed by
wait({tier:'local'}). Its scoped-form owner already validates the settings schema, observes local
workspace/membership facts, checks owner/admin policy and drains issued writes on scope changes.
Do not extract currency, Finance roles, schema, generic forms or translated feedback into the library.
Do not split name and currency into separately committed writes.

A request carries a host scope, workspace ID, proposed name and opaque companion settings. The
operation trims the name and rejects an empty result. The host assesses locally known eligibility
and companion-setting validity, then supplies issue and persistLocal leaf adapters. issue performs
exactly one already-decided update and returns its receipt in a plain {write} envelope; persistLocal waits only for durability.
The envelope prevents implicit Promise assimilation of a thenable SDK receipt before persistLocal
chooses an explicit tier. These capabilities must not hide queries, read/check/write orchestration, remote preflights or
transaction callbacks. Later adapters must be recursively inspected against this requirement.

## Machine-first model

validating -> assessing -> writing (issuing -> persisting -> resolving) -> finite outcome.
Assessment is a side-effect-free local leaf, invoked so thrown assessment errors have an explicit
failure path. Blocked assessment returns the host reason. Invalid/blocked/assessment failure have
notStarted settlement. Successful local persistence has locallyPersisted settlement; an issue or
persistence error is conservatively unknown, never a reason for automatic replay.

Writing has parallel interruption control: active -> cancelling, invalidated or closing. Shutdown
outranks invalidation, which outranks cancellation. During issue/persist these events never stop the
invocation or imply rollback. Resolving chooses the interruption outcome while preserving actual
local/unknown settlement. Before issue, cancellation/invalidation/shutdown is immediately finite
and no write is issued. No actor retry event exists; the host reconciles unknown settlement first.

An invocation is fixed to one request and scope. The host owns current observations and must forward
invalidation when identity, attachment, workspace, or permissions change. It must wait for the finite
result before releasing an issued operation or stopping the actor. Raw actor.stop cannot guarantee
drain and is not supported as domain cancellation. No global session, query or worker is created.
There is no partial write plan: one atomic settings update succeeds locally or is unknown.

## Adoption and review sequence

First review this generic operation and its recursive leaf audit; then add unit and package consumer
coverage after approval. Cover canonical name, blocked/throwing assessment, no write after early
interruption, interruption during issue/persist, actual settlement retention, unexpected leaf errors,
priority, no retries and scope correlation in the output.

Finance adoption follows as its own focused review. Retain its current form/readiness owner and
compose this finite operation through an invoked adapter rather than manually starting an actor.
The existing data adapter must separate issuing an update from waiting for local persistence without
changing permission enforcement, atomic settings, query ownership or later rejection behavior.
Assess adapter helpers recursively. Preserve the current view, Paraglide callers and currency UI.
Qualify rename/default-currency unit/browser behavior and cold offline/stalled-server saves after
that implementation is reviewed. No localization generation or new text is proposed.

## Implementation review status

Implemented the contracts and finite operation with workspace/naming/contracts and
workspace/naming/workflow package subpaths. Recursive leaf audit: assess is a pure local verdict;
issue performs one host update and returns an opaque receipt envelope; persistLocal performs one
explicit durability wait. There is no nested helper orchestration or transaction callback. The
parent host still owns SDK disposal, later rejection observation and explicit uncertainty recovery.
Once the issuing state begins, interruption conservatively drains it even if its leaf has not yet
returned a receipt. The host must not mutate submitted settings while the operation is active.

TypeScript, focused Oxlint/formatting, package/publint and diff checks pass. No implementation tests
were added or run, no Finance source was changed and no commit/push/publication occurred. After
review, include a thenable-receipt fixture to prove that issuance cannot implicitly await authority
acceptance, plus the interruption/error/settlement cases above.

## Approved operation coverage

The user approved continuation after implementation review. Nineteen focused workflow cases pass:
canonical names and unchanged companion settings, empty input, denied/unavailable verdicts, thrown
local assessment, three interruptions before issue, the same interruptions during issue/persistence,
unknown issue/persistence failures without replay, interruption priority, receipt release and opaque
thenable receipt handling. The intentional thenable fixture has one documented lint-rule exception
so its then method can detect the exact accidental-assimilation behavior under test.

TypeScript, focused Oxlint/formatting and diff checks pass. Package/publint and the complete public
consumer check pass: declarations resolve the new subpaths, a domain-free Node consumer executes
one naming operation with its local receipt, and the existing Svelte consumer still builds. No
production correction was needed. No browser test is needed for this actor-only operation; Finance's
SDK adapter, actual persistence and existing form behavior are not yet adopted or qualified here.

Finance remains unchanged on its fresh branch. The next focused implementation is its invoked
persistence adapter beneath the existing settings form, preserving the single atomic name/currency
write and current local policy owner. Review that adapter before adding or running its coverage.
No catalogs or generated localization were modified, no server was started and nothing was committed
or published during this coverage cycle.
