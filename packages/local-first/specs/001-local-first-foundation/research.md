# Phase 0 Research: Local-First Foundation

**Date**: 2026-10-14
**Status**: Documentation/source investigation only. No runtime qualification or implementation tests.

## Decision: Backend-Native Identity Reuse

The user approved replacing the universal app-isolation requirement with explicit identity
reuse and documented backend-native access behavior. Preserve the portable practical v1 data
baseline, optional transaction capabilities, workspace membership, and app-required domain
authorization. Organization of app data does not establish a security boundary between apps
holding the same identity authority.

The earlier claim that neither backend had an established identity-reuse path was too broad.
Source investigation establishes those paths and their different access consequences. No
broker, restricted credential service, or external identity provider is required by this
revised v1 requirement. Foundation-provided automatic SSO, a shared workspace directory, and identity portability across
Foundation-provided automatic SSO, a shared workspace directory, and identity portability between
backend technologies remain outside v1. Reusing an identity does not by itself share app data.
Identity reuse alone grants no cross-workspace data access. The user endorsed an explicit request
from one app/workspace to another and user approval or denial, analogous to consent-based service
integrations, but decided to defer this data-sharing flow from v1 until backend capabilities and
portable authorization semantics are evaluated. Native discovery/access after identity connection
may occur and must be documented and explained, not assumed portable.

The identity-isolation blocker is withdrawn, not marked as successfully qualified. Remaining
data, permissions, recovery, and durability research must continue before contract stabilization.
Runtime qualification is still future work; exact SDK/server versions remain to be selected.

## Source Investigation Provenance

Official repositories were downloaded to temporary directories and inspected without executing
implementation tests or changing either source checkout:

- Jazz: `garden-co/jazz`, commit `45905c42946a07465ca33ec8a84e4180771aff74`,
  local checkout `/private/tmp/jazz-identity-audit`.
- DXOS: `dxos/dxos`, commit `0d811677577e239ae9a0f8b6ab035cb9c986835b`,
  local checkout `/private/tmp/dxos-identity-audit`.

These revisions pin the identity investigation, not a released dependency selection or full
capability qualification. Temporary checkout paths are convenience references only; the
permanent source links below are the reproducible evidence.

## Jazz: Reused Identity, Separate App Accounts

Decision: retain Jazz; its native identity model supports the revised identity requirement.
Overall plugin qualification remains pending.

The same local-first root derives the same signing key and identity subject. The token is
minted for a selected app audience, while the account ID is derived from app ID plus identity
subject. Restoring a secret in another app therefore preserves the identity while creating or
recovering its separate app account. App registries and account context handles are app-scoped;
this is actual native behavior, not just a proposed architecture.

Sources: [identity and audience construction](https://github.com/garden-co/jazz/blob/45905c42946a07465ca33ec8a84e4180771aff74/crates/jazz/layers/types/src/identity.rs#L74),
[app-scoped account derivation](https://github.com/garden-co/jazz/blob/45905c42946a07465ca33ec8a84e4180771aff74/crates/jazz/layers/types/src/account_registry.rs#L53),
[secret restoration](https://github.com/garden-co/jazz/blob/45905c42946a07465ca33ec8a84e4180771aff74/packages/jazz-tools/src/accounts/local-first.ts#L43),
[account context scope](https://github.com/garden-co/jazz/blob/45905c42946a07465ca33ec8a84e4180771aff74/packages/jazz-tools/src/accounts/context.ts#L37).

Limit: an app holding the shared root can mint a token for another audience. Audience validation
restricts a token, not the authority of the root holder. Do not describe secret reuse as
sandboxing the two apps from one another. This distinction is now an access-disclosure
requirement, not a reason to reject the backend. An external identity provider with separately
issued app credentials is another possible architecture, but is not selected or required here.

Queries, sorting, limits, and reactive data access cover much of the baseline in documentation.
Further source inspection confirms general IsNull/IsNotNull lowering, including nullable bytes
and arrays in upstream examples. Exact portable null/absence semantics still need design. Local persistence and remote authorization are
separate outcomes; a locally persisted write may later be rejected, which the contract must expose.

Sources: [queries](https://jazz.tools/docs/reading/queries),
[filters and sorting](https://jazz.tools/docs/reading/filters-and-sorting),
[writing and durability](https://jazz.tools/docs/writing/writing-data).

Mergeable transactions and exclusive authority-validated transactions are documented separately.
Mergeable remote row delivery is not necessarily atomic; local crash atomicity and advertised
subscription behavior need qualification. Optional capabilities must not be inferred from API names.

Sources: [transactions](https://jazz.tools/docs/writing/transactions),
[local-first authentication](https://jazz.tools/docs/auth/local-first-auth),
[authentication lifecycle](https://jazz.tools/docs/auth/lifecycle).

Version caution: Finance currently locks `jazz-tools` 2.0.0-alpha.59. This is reference evidence,
not a selected foundation dependency. Current v2 documentation must not be mixed with classic
CoValue/group documentation or assumed to describe that exact alpha release.

## DXOS: Reused Identity Shares Native Space Authority

Decision: retain DXOS as the first second-backend candidate. Source inspection supports native
identity reuse with shared access consequences; it does not qualify every mandatory capability.

A device joining an identity receives authority to sign for that identity. The authorized-device
credential contains identity/device keys rather than an app-specific allowed-space scope. The
cross-device synchronizer processes space membership credentials in HALO and accepts the spaces,
excluding HALO itself, deleted spaces, and already-present spaces. Tags are passed to admission,
not used there to impose app-specific authorization. Space authentication trusts member identities.

Sources: [identity signer and device admission](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/sdk/client-services/src/Identity.ts#L198),
[authorized-device credential](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/core/protocols/src/proto/dxos/halo/credentials.proto#L104),
[automatic space acceptance](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/sdk/client-services/src/internal/services/cross-device-space-synchronizer.ts#L90),
[space member authentication](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/sdk/client-services/src/internal/spaces/data-space.ts#L162).

This is the native multi-app data model the user wanted to preserve. Separate app schemas,
spaces, and tags can organize data, but must not be presented as isolating apps that hold the
same identity authority. The identity-connection interaction must disclose native authority/access. Shared identity does not imply shared app data. The user endorsed an explicit app/workspace access request-and-approval workflow but deferred it from v1 pending backend-capability evaluation.

For genuinely separate principals, DXOS also supports separate identities invited to selected
spaces. The invitation path admits an identity to a specific space and the recipient verifies
the credential's subject. This remains an alternative for consumers needing a different trust
model, not the required v1 identity-reuse implementation.

Source: [space invitation protocol](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/sdk/client-services/src/internal/invitations/space-invitation-protocol.ts#L94).

ECHO documents typed objects, mutation, and reactive queries. Space roles do not by themselves
prove record-level app restrictions. Multi-object atomic persistence and authority validation
remain unverified, rather than proven absent. Current and older DXOS guides must be distinguished;
older seed-recovery roadmap text is not evidence about the current recovery API.

Sources: [queries](https://dxos.org/docs/echo/typescript/queries/),
[mutations](https://dxos.org/docs/echo/typescript/mutations/).

## Remaining Qualification Work

For each backend, record and eventually validate the observed identity/account mapping,
credential scope, space discovery, and access when connecting a second app. Check that the
connection interaction explains the consequences before explicit connection. Shared root or
device authority is permitted; no universal denial between those apps is required.

Continue qualifying private workspace protection. Document backend-defined membership/access
levels without assuming a generic read-only role. Finance permission-checking code is not a product
requirement; qualify other domain restrictions only after explicit consumer approval. Recovery/device
linking, generic null/range/AND filtering, sorted bounded reactive results, local durability, later
rejection, and optional transaction semantics still require further evidence and eventually
executable qualification.

No claim of full qualification follows from this investigation. A failure of another mandatory
requirement must still block qualification or prompt an explicit user scope decision. Backend
source findings inform design; implementation and tests require separate authorization/review.

## Local UI Evidence

Local `delightful-ui` 0.0.24 contains Dialog and Popover components. Dialog exposes heading/open
state and native modal behavior; Popover wraps a native auto popover. Reuse these as discovery
inputs. Focus restoration, dismissal during pending operations, announcements, consumer
localization, and sensitive-data cleanup still need interaction-specific design and validation.
Do not label these existing primitives missing or copy them into the foundation.

## Follow-up: Mandatory Data and Permission Evidence

See [qualification.md](qualification.md) for the source-backed capability matrix and exact paths.
Both backends have concrete primitives for the practical query baseline; DXOS also exposes a
host-storage flush acknowledgement. None of these findings substitutes for restart/failure tests.

The traced DXOS native peer data path admits nonremoved members to replication and its inbound
mutation policy is permissive. This is recorded as backend access-model evidence, not a failure
against a generic read-only membership requirement, which is not in scope. Private workspace
protection remains a requirement and must be qualified. Finance permission-checking code is not an
approved product requirement; evaluate additional domain restrictions only if explicitly approved
for a consumer. Membership administration and domain authorization must not be conflated.

## Follow-up: Published DXOS and Alternate Enforcement

The [alternate-path review](qualification.md#follow-up-alternate-dxos-enforcement-paths)
checked the published 0.14.0 host/services source archives, legacy feed admission, and the
Keyhive migration plan. Published code reproduces the permission limitation. Keyhive access
control exists as separate alpha Automerge work, while DXOS's integration remains draft in
the audited source. No supported native fix was established.

Recommendation: preserve private workspace protection; retain DXOS as an unqualified candidate
until mandatory behaviors are validated. Do not claim generic read-only membership support or
implicitly expand this project into an authorization subsystem. Finance permission-checking code
is not a product requirement. Full two-backend acceptance remains future work.

## Core Design Draft Following Review of the Native Limits

The user authorized continuing core design with DXOS's permission limitation visible. The draft
[data model](data-model.md), [contract](contracts/foundation.md), and [validation guide](quickstart.md)
define required behavior without claiming that a native DXOS adapter implements it. Design
choices such as the small scalar set, deterministic query ordering, declarative policy dialect,
and props-based localization are proposals for this review, not executed qualification findings.

This is a provisional design step; the broader backend mapping is not complete. No additional
backend, authorization service, package versions, migration implementation, or UI primitives are
selected by these documents. No implementation or tests were added. Two real qualifying backends
remain required before the portable contract can be stabilized.

## Contract Consistency Review

[design-review.md](design-review.md) maps all functional requirements and success criteria to
design/validation sections, distinguishes remaining research from draft coverage, and records
corrections to permission composition, immutable scope, lifecycle commands, and unknown operation
settlement after restart. These are documentation clarifications, not backend support findings.

## UI Discovery Follow-up

[ui-discovery.md](ui-discovery.md) provides pinned/source-based interaction evidence, a current
local DUI inventory, and ownership recommendations for FR-015. Existing StatusMessage and
FieldFeedback cover operation/field feedback; do not implement stale Finance comments as new
DUI requirements. Optional clipboard-copy and QR presentation are generic DUI candidates;
account/recovery, pairing, membership, and backend authority disclosure remain foundation-owned.
No reference app, component, or test was executed or modified by this discovery task.
