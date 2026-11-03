# Shared workflow and resource contract

The public factory APIs will be typed from this protocol during implementation; this document does not pretend an unreviewed full TypeScript signature is final. Pure archive handling and stateful lifecycle exports are separate. No Finance or Jazz types appear in the shared profile contract.

## Actor ownership

Consumer integration owns the existing session binding, access observations, browser file input/download effects, and the lifetime of one backup operation. DLF owns the generic export/inspection/restore coordinators. Consumer capture and destination adapters are child actor logic where they have multiple meaningful steps, not promise functions hiding a whole workflow. Promise actors may perform one bounded leaf operation (one read, one digest, one journal lookup).

Resource owner children hold passwords, keys, decoded bytes, file handles, and capture leases privately. Parent context holds only opaque resources and safe progress. Neither parent nor child persisted snapshots may contain secrets or decoded records; persistence serializes only the explicit restore journal. This is a persistence boundary, not a claim that JavaScript memory can be reliably zeroized. Clear references and worker resources on release; strings and Web Crypto internals may remain until garbage collection.

## Profile responsibilities

The profile supplies exact ID/version and codec validators; authorized capture logic; domain graph validation; destination preparation/restore logic; authoritative reconciliation; recovered-content comparison; activation; and incomplete destination reporting. Each operation observes the bound generation and reports structured non-sensitive failures. Caller-supplied logic follows the same machine-first/resource ownership review as shared code.

A validated archive has no write authority. Before new writes the destination logic rechecks current authority and archive/profile binding. Capture ownership and restore authority are different capabilities.

## Export statechart

```mermaid
stateDiagram-v2
    [*] --> checkingAuthority
    checkingAuthority --> acquiringCapture
    acquiringCapture --> drainingWriters
    drainingWriters --> capturing
    capturing --> validatingCapture
    validatingCapture --> encoding
    encoding --> protecting
    protecting --> handingOff
    handingOff --> releasing
    releasing --> exported
    exported --> [*]
```

All active states handle cancellation, binding invalidation, child failure, and unexpected errors by entering cleanup appropriate to owned resources. Acquisition cancellation must still collect and release a late acquired lease. A failed or incomplete capture never enters encoding. Protection is plaintext digest or authenticated encryption. Handoff does not imply retained-file validation. Capture can be released after validated immutable capture exists; implementation should shorten its duration without releasing it before all consistency checks finish.

## File inspection statechart

Selecting → bounding input → parsing header → requesting password when needed → authenticating → validating generic payload → validating recognized profile → reporting → releasing. Repeated password attempts do not write destinations. Cancellation during native cryptography can discard eventual results, but cannot claim the underlying call stopped. Worker termination is explicit resource cleanup where used.

## Restore statechart

Validated immutable resource → checking destination authority → finding or creating operation journal → preparing isolated destination → reconciling batch → staging batch → committing → waiting for global settlement → advancing progress → comparing actual destination contents → activating → reconciling activation if unknown → verified complete.

A write resource owner models acquisition, staging, commit, confirmation, rollback when possible, and unknown outcome. After commit/cancel or access loss, it drains issued calls and preserves operation identity; parent cancellation does not blindly exit the owner. Before issuing any later writes, settle or classify the current write. Absence is conclusive only through a qualified authoritative read at the expected IDs; otherwise return unresolved incomplete. Conflicting content stops restoration; no automatic overwrite.

Batch size is deterministic and bounded by record/byte budgets. Relation cycles and graph groups requiring atomic policies are profile-owned transaction plans; batching cannot split atomic invariants merely to fit a generic loop. Phase transitions are states, not an async loop hidden in a promise actor.

## Events and reports

Consumer commands: start export, inspect file, supply password, start/resume restore, cancel, request drain. Observations: binding/access invalidated, dependency failed, global confirmation/rejection, file handoff result. Child reports carry generation plus operation identity and typed settlement. Public views expose progress stage, counts, localized message descriptors, recovery operation reference, and actionable errors, never passwords, decoded records, private file names in telemetry, or child state paths.

Graceful shutdown: stop new work → ask active write owners to drain/reconcile → retain incomplete journal → release capture/file/crypto resources → acknowledge → stop. Closing a dialog cannot undo a committed write. Retry navigation/file download independently of already successful data operations.
