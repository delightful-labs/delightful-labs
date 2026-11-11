# Workspace research: retained SDK findings

Version boundary: installed `jazz-tools@2.0.0-alpha.59` and `xstate@5.33.2`.
These findings came from installed executable JavaScript/declarations and application code.
Recheck the installed source when upgrading. Product decisions belong in [spec.md](spec.md),
current implementation in [plan.md](plan.md); superseded implementation proposals are omitted.

## Jazz constraints

Paths below are relative to `node_modules/jazz-tools/`.

- `dist/classic-api.js`: Classic Group/invite exports are throwing removal stubs. Their presence
  in exports does not establish a usable v2 invitation API. Future sharing needs its own admission design.
- `dist/permissions/index.js`: table select/insert/update/delete rules compile to row policies;
  updates have old/new conditions. Membership and account grants are authorization inputs, not URL
  selection. Policy compilation alone does not prove server acceptance or every revocation transition.
- `dist/runtime/client.js`: `LocalFirst` includes cached/pending data. `Remote` waits for authority
  and excludes pending local writes. `LocalFirstUnlessEmpty` may wait for remote data while connected
  or connecting, but can return an empty local result offline, unconfigured or after connection failure.
  Empty local data cannot establish first use or globally complete workspace membership.
- `dist/runtime/db.js` and `dist/runtime/client.js`: explicit transaction handles support keeping one
  transaction across machine-owned read/check/stage/commit/rollback states. Preserve transaction-time
  invariant checks. Ordinary mergeable transactions do not establish globally serialized last-owner
  or uniqueness rules across clients.
- The write handle has separate local/global waits. Local settlement is durability, not server-approved
  sharing. Stopping an actor or losing connectivity does not undo an issued write. Future online-only
  access administration needs an actual authoritative protocol, not merely a global wait after local
  application.
- Caller-supplied insert IDs support stable attempts; they do not establish safe blind replay or upsert
  idempotency. Journal first, reconcile IDs/relationships, and preserve subsequent user edits.
- `dist/svelte/query-subscription.svelte.js`: changing a dynamic query can mark it loading while
  retaining its prior current value. Bindings/readiness must be checked before using retained rows to
  render or authorize another workspace.

## XState constraints

Fixed children are invoked under compound owners spanning work and draining. Promise actors perform
leaf I/O; statecharts own sequential decisions, acquisition and cleanup. Stopping a promise observer
can discard its eventual result without cancelling its side effect. Keep actual transaction/journal
settlement with the resource owner. Correlate reports by binding and generation, not matching workspace
UUID alone. Use public reports and presentation selectors rather than copied private child snapshots.
The repository's [XState memory](../../.specify/memory/xstate.md) is the practical design reference.

## Boundaries still requiring research before future sharing

- Identity lookup, verification, invitation redemption, expiry and replay prevention in v2.
- Effective capabilities and narrow selected-account supporting-record visibility under row policies.
- Authoritative uniqueness, multiple-owner and last-owner rules under concurrent clients.
- Online access administration with truthful unknown outcomes and no promised offline queue.
- Revocation propagation and cached visibility on disconnected devices; no offline erasure guarantee.

Creator bootstrap and outsider-denial browser checks exercise specific current policies, not all of
those future transitions. No trusted v2 invitation primitive, global serialization guarantee, or
remote cache-erasure mechanism was established by this research.
