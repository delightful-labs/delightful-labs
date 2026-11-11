# Core Contract Consistency Review

**Status**: Historical review of the retired multi-backend proposal. Its requirement numbering,
two-backend gates and portable-schema assumptions are superseded by the [Jazz-first specification](spec.md).
Current delivered slices and remaining work are recorded in [the plan](plan.md). This document is
not a current implementation or release checklist.

## Corrections Applied

| Finding                                                                       | Correction                                                                                                                      | Why it matters                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| App policy composition could be interpreted as replacing workspace membership | Any future approved app policy cannot grant access to a nonmember or permit self-granting; no such policy is in the v1 baseline | Prevents accidental authorization assumptions without importing app-specific requirements          |
| Updating a record's workspace was underspecified                              | Record ID and workspace binding are immutable; scope changes require new handles                                                | Updates cannot move protected data across a workspace boundary                                     |
| Close, logout, and cancellation were conflated                                | Defined separate outcomes, credential retention disclosure, stale-handle rejection, and retryable failed close                  | Closing a tab is not global logout; cancelled UI does not undo committed authority or writes       |
| Operation recovery could imply a new universal durable event journal          | Active runtime retains rejection listeners; restart reconciliation uses native evidence or unknown                              | Avoids false acceptance and accidental duplicate retries without inventing an unapproved subsystem |
| Error code was an unconstrained string in the example type                    | Added a closed proposed error-code union, including scope/lifecycle failures                                                    | Consumers can handle invalidated handles and failures explicitly                                   |
| Plan header named a feature branch that is not checked out                    | Corrected the current branch to main                                                                                            | Documentation no longer implies branch setup occurred                                              |

The contract remains a proposed review draft. These corrections clarify the current requirements;
they do not establish private workspace protection on the native DXOS peer path or change the
approved identity-reuse decision. Cross-app data sharing is deferred from v1.

## Requirement-to-Design Map

“Covered” below means a behavioral draft exists, not an implementation or a passing scenario.

| Requirements                   | Design location                                                                              | Review result                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001, FR-002                 | Contract: Package and Dependency Boundaries                                                  | Separate distribution/core dependencies covered; publication names deferred                                                                                                  |
| FR-003, FR-004, FR-005         | Contract: Registration, Compatibility, and Capability Checks; quickstart reporting           | Version/capability/preflight behavior covered; executable conformance absent                                                                                                 |
| FR-006, FR-012                 | Contract: Conceptual Public Surface; Errors, XState, and Presentation; data model identities | Lifecycle/native authority disclosure covered; concrete native steps still need mapping                                                                                      |
| FR-007, FR-008                 | Contract: workspace membership; conditional policy extension                                 | Private workspace behavior is required; backend-specific shared access mapping and DXOS private-data isolation remain unresolved; no domain-policy feature is required in v1 |
| FR-009, FR-010, FR-020         | Contract: Portable Query Semantics; data model fields                                        | Practical baseline and cleanup covered; exact typed signatures/adapters and comparison qualification pending                                                                 |
| FR-011                         | Contract: Operations, Durability, and Transactions; quickstart persistence scenarios         | Local/remote outcomes covered; native crash/restart behavior untested                                                                                                        |
| FR-013, FR-014                 | Contract: Errors, XState, and Presentation; quickstart interaction scenarios                 | Props/message-bundle boundary, focus/dismissal, secret cleanup covered; no UI built                                                                                          |
| FR-015                         | ui-discovery.md                                                                              | Source-based reference-flow evidence and DUI reuse/gap recommendations drafted; live usability/a11y validation remains future work                                           |
| FR-016, FR-017, FR-018, FR-019 | qualification.md; quickstart prerequisites/reporting; plan gates                             | Two real backends, isolated deployments, native limits explicit; full qualification unsatisfied                                                                              |
| FR-021, FR-022                 | Contract capability/query/transaction sections                                               | Deferred rich queries and independent optional transaction guarantees covered; no parity claim                                                                               |

All 22 functional requirements are mapped. This does not upgrade the specification quality
checklist into an implementation-readiness or qualification certificate.

Success-criterion coverage is likewise planned: SC-001/SC-003 preflight/independent integration;
SC-002/SC-009 two real backends with identical portable declarations; SC-004 native identity
flows; SC-005 private workspace isolation; SC-006 offline durable restart; SC-007 readiness/
disposal; SC-008 keyboard-usable embedded compositions; SC-010 optional transaction qualification;
SC-011 identity reuse with disclosed native access. None has been executed by this review.

## Remaining Work Before Dependent Implementation

Constitution wording was reconciled in v1.0.1 in its own review cycle. Source-based FR-015
discovery is now drafted in [ui-discovery.md](ui-discovery.md), including existing DUI status/field
feedback and proposed optional copy/QR primitives. Neither follow-up establishes runtime passes.

1. Refine the behavioral API into exact typed interfaces and the smallest concrete schema/query
   grammar, plus plugin/host ownership of credential, persistence, and interaction adapters. Do not
   design a domain-policy grammar absent an approved consumer requirement. Review these before
   implementation; the current conceptual surface is not a finished SDK.
2. Pin the implementation toolchain/native SDK-server combinations and document their deployment,
   migration, recovery/device flow, synchronization, and diagnostic-retention behavior. Root
   tooling versions do not imply application dependency compatibility.
3. Establish two backends that qualify for the mandatory foundation behaviors before claiming
   cross-backend acceptance. Keep source-backed DXOS access-model limits visible when assessing
   private workspace isolation. Any future domain policy requires explicit consumer approval and
   separate design review.
4. Use the per-backend status matrix in [qualification.md](qualification.md) to separate source
   evidence from unknown mappings and runtime results. Resolve open portable semantics before
   designing qualification scenarios; do not treat the matrix as proof of compatibility.
5. Keep the user-approved request-and-approval cross-app data-sharing direction outside v1. Revisit
   it only after backend capability evaluation and a separately reviewed scope decision.

Core design can continue with required behavior and fail-closed unsupported configurations.
Backend-specific implementation tasks must not claim the above choices/mappings are settled.
No further application capability is made mandatory by this review, and no workaround is selected.

## Validation Performed

Focused Oxfmt checks, whitespace checks, local documentation-link validation, and a static map
of FR-001 through FR-022 and SC-001 through SC-011. These are document checks, not implementation
tests. No dependencies, production source, routes, components, development server, or tests were
added or run.
