# Jazz schema and permission design memory

Read this before designing Jazz data relationships, permissions, or persistence behavior.

## Local usability is independent of remote freshness

Verified against the published `jazz-tools@2.0.0-alpha.59` package and official docs during
[startup research](../../specs/013-local-first-startup/research.md). Recheck source on SDK upgrades.

- Ordinary browser reads default to local data with upstream propagation. `ReadTier.LocalFirst`
  explicitly includes cached records and pending local writes while synchronization continues.
  `LocalFirstUnlessEmpty` can wait for a remote first answer when empty; `Remote` waits offline.
  Neither belongs on a path that must immediately use already available local data.
- Ordinary mutation/mergeable-transaction completion should wait for `local` persistence, with later
  rejection observation retained. `global` means server acceptance. Exclusive transaction `wait()`
  confirms authority acceptance and cannot provide offline completion with a remote authority.
- Server permission enforcement does not require an authoritative preflight for every ordinary
  action. Use current locally known membership/grants and required records; invalidate on observed
  changes. Offline knowledge is not proof of fresh remote permission or erasure after revocation.
- Separate availability from completeness: an empty local result does not establish global absence,
  first use, or permission to recreate/repair records. Keep initialization provenance, repair,
  seeding, and uncertain-write reconciliation from blocking unrelated locally usable finance work.
  Do not remove idempotency safeguards or blindly replace remote reads in recovery/repair workflows.
- Persistent browser Jazz already uses a SharedWorker with IndexedDB; memory-driver and external
  runtime defaults differ. Moving application logic into a worker requires explicit verification of
  local-first reads, supported database access, message boundaries, and lifecycle ownership.
- A service worker cannot construct SharedWorker (Window-only API). Cache public shell/runtime
  assets; do not assume a supported early Jazz handoff, always-running session, or HTTP caching of
  Jazz sync/auth/data. Runtime asset URLs and version identity require a production-build audit.

The linked draft and backlog distinguish desired changes from current implementation and unverified
optimizations. Preserve separately approved online-only sharing/permission administration and explicit
bank-provider operations; those exceptions must not spread into ordinary local finance workflows.

Consolidated spec 013 verification adds these boundaries (see
[`investigation-results.md`](../../specs/013-local-first-startup/investigation-results.md)):

- An online snapshot is not proof of cold query coverage. A never-opened shared-workspace probe
  returned permitted rows online but encountered `NotObserved` after browser restart, including
  with explicit LocalFirst and authorization-fact warming. Verify exact cold query shapes; do not
  treat coverage failure as remote absence or proof of physical byte erasure. Later controlled
  two-identity probes on the same SDK retain 5,000 permitted of 10,000 records across cold restart
  with an unanswered connection, including root/scoped/ID queries. Metadata-only roots also retain
  permitted references without bytes; a later explicit online request fetches content. The earlier
  failure remains unexplained. See cold-query-follow-up.json; neither probe establishes coverage
  for every relationship, permission scope or history.
- A compiled WebAssembly.Module can be cloned in memory but cannot be stored in IndexedDB under
  the current WebAssembly serialization rules. Chromium, Firefox and WebKit probes rejected it
  with DataCloneError. Do not design a persistent compiled-module cache from older guidance.
- Attachment links must inherit transaction read access, not merely check parent existence. The
  reverse files-read inheritance composed with that rule fails publication on alpha.59 for the
  current organization/account predicate. The supported alternative uses files' existing direct
  transaction relation: files require transaction read access AND an attachment matching both
  fileId and transactionId. Parts inherit file reads. The full-app permission suite verifies
  owner/admin, all-account member/viewer, selected grants, denied accounts, unrelated users,
  mismatched-organization grants and cross-transaction links. Unlinked files remain unreadable.
  Preserve both the direct read and matching-link checks; publication alone does not prove access
  correctness. See spec 013 reproductions/README.md for the rejected expression and alternative.
  Cold coverage remains unproven; this authorization repair does not enable broad preparation.

Retained background query choice also needs a projection check. In spec 013's controlled alpha.59
probes, one-shot snapshots stayed stale after the observed one-second remote-edit window. Public
select('id') subscriptions retained updated/new full transaction fields and audit metadata across
cold restart; ID-only file/link queries retained full metadata without file-part acquisition. At
5,000 readable transactions, retained ID queries added 10.3 MiB page heap versus 21 MiB for full/audit
rows. Both public subscriptions still deliver full result arrays per update. These are page-only,
single-sample measurements, not worker/storage budgets or guarantees for every relationship. See
preparation-cost-follow-up.json under spec 013. Prefer testing public ID projection before accepting
full-row global materialization or assuming a private counts-only subscription is necessary.

## Reuse proven reference patterns; verify the exact predicate shape

The Check implementation is a working precedent for validating a row's single foreign-key
reference. `transactions.checkId` points to a Check, and `checkReferenceCondition` requires the
referenced Check to match the transaction's organization and account. The permission uses a
positive `policy.checks.exists.where(...)` query with values from the transaction row context.

That precedent does not establish that every cross-row invariant is expressible. In particular, a
single foreign-key existence check is different from comparing two referenced sibling rows to one
another, or from expressing a negative relationship-existence query. Do not infer a Jazz limitation
from a rejected policy until comparing it with the working schema, permission helper, and policy
tests already in this repository. Also do not infer support for a more complex predicate just because
a simpler Check reference works.

Atomic database writes and permission expressiveness are separate questions. An exclusive
transaction may atomically stage and settle multiple rows while the server policy still rejects the
predicate intended to validate those rows. Diagnose the exact policy expression and runtime error
before changing the data model or proposing a different persistence authority.

## Full-policy linked deletion in alpha.59

The production transfer schema uses explicit `s.rel` references from a transfer to both endpoint
transactions. A transaction endpoint must remain undeletable while a transfer row references it,
even after its `internalTransferId` marker has been cleared. Keep the marker-clear write separate;
then delete the transfer row and the selected transaction rows together in the final mergeable
bundle. The full app policy suite verifies this bundle at global durability.

The transfer deletion and insertion permissions must preserve write access to both endpoint
accounts. On alpha.59, two nested `canWriteAccount` predicates prevented the new paired transaction
from settling globally. Use the equivalent factored transfer-specific predicate: owner/admin or
all-account write access, or a selected-account member with write grants to both endpoint accounts.
An earlier experiment applying this to inserts rejected the browser flow; the later investigation
identified the separate circular insertion dependency rather than treating that warning as final.

[Jazz's documented transaction authorization](https://jazz.tools/docs/auth/permissions) permits
references to the transaction's own independently authorized writes, but not new rows granting each
other access in a cycle. Transfer endpoints requiring the new transfer, and the transfer requiring
both new endpoints, form such a cycle. Rearranging boolean expressions or write order does not fix it.

The user approved direct account-based insertion authorization for new **manual** transaction rows,
including their forward marker, while retaining all existing reference/access checks and full
transfer endpoint validation. Authorized standalone manual orphan markers are now an application
integrity boundary, not an insertion denial. Provider inserts do not gain that exception. Keep marker
update guards, financial-fact immutability and transfer/read/delete checks; do not replace local
settlement with global waits or split the three-row atomic operation. Verify accepted roles/grants,
forged-fact atomic rollback, provider orphan rejection and manual orphan/update boundaries explicitly.
Linking already-accepted provider endpoints has a separate cycle: both marker updates require the
new transfer, while its insert previously required both new markers. Transfer insertion now accepts
complete matching endpoint facts with either both markers pointing to that transfer or both markers
clear. The latter anchors authorization in accepted unlinked rows and also admits the already-supported
pending-unlink state. Both-account write access and marker-update guards remain mandatory; mismatched
facts and endpoints claimed by another transfer are rejected. New links write all six side-specific
account/amount/currency facts. Synced-provider browser fixtures must confirm global acceptance before
linking; link fixtures also confirm global acceptance so optimistic UI cannot conceal rollback.
See `docs/transfer-creation-permission-investigation.md` for the exact decision and reproduction.

Before relying on a new policy shape, validate it against the installed Jazz version and its actual
policy test/runtime path. Include both accepted and rejected cases for the precise relationship and
correlation being introduced.

Spec 013's final acquisition investigation supersedes its initial LocalFirst background proposal:
use Remote-tier ID subscriptions only for independent server-facing acquisition, leaving foreground
reads/saves LocalFirst/local. Global LocalFirst views stayed stale after observed grant removal;
Remote subscriptions passed grant/member/admin/profile/link changes in all three browser engines.
Use a real wire proxy for silent-transport tests: page routeWebSocket mocking did not reliably block
the SharedWorker. Real-proxy subscription-only tests retain full fields/audit/inserts/deletes and
on-demand file metadata cold. See remaining-investigation-results.json under spec 013.

Correct replication does not qualify a startup sweep: 5,006 initial records caused a roughly
three-second main-thread long task. Public retained orderBy(id)/offset/limit pages reduce individual
stalls and retain tested cold coverage/live boundary behavior, but increase acquisition time greatly.
Budgeted paging/growth/scheduling requires a statechart and focused review before production adoption.
Never equate a local callback, a count, or independently timed page results with global completeness.
Namespace deletion retained identity in the disposable test, but does not certify OS eviction or
whole-origin recovery. The Chrome quota override allowed writes over its reported quota, so actual
quota-failure handling remains unverified. No private storage/SDK workaround was used.

Dedicated-worker preparation was tested on alpha.59 in all three desktop browser engines. Public
createAccountManager with a custom AccountStore, restoreLocalFirst and createDb can open a worker
client and receive authorized live queries. However, both persistent and memory worker settings
left zero records available to a cold page; the matched persistent page control retained all records.
The SDK's window-based runtime detection selects a direct worker client rather than the browser
persistent SharedWorker path. A matching identity/app/env/dbName does not establish shared storage.
Public runtime asset overrides do not supply a replica attachment; inspector ports and static worker
factory methods are internal, not application APIs. A 5,000-row worker sample avoided the page's
roughly 2.7-second stall, but failed the persistent preparation purpose. Do not implement this worker
owner or copy rows back through application writes. See spec 013 worker-preparation-results.json.

Spec 014 retention verification adds a transaction-tier boundary on alpha.59:
the completed-history query returned 101 rows at Remote tier outside the browser
transaction but zero at Remote tier inside it. The same machine passed its Node
full-policy test, so that alone did not establish browser behavior. Acquire the
authority snapshot before the exclusive transaction, then recheck at LocalFirst
inside it and require matching attempt and account-result identities before
staging the atomic deletion. Terminal log records are immutable under the policy.
Browser retention and full-policy tests verify this path; unit tests reject
partial/mismatched local knowledge. See
[`spec 014 verification`](../../specs/014-bank-sync-log/verification.md).

## Alpha.60 transfer predicate semantics

The minimal transfer-policy fixture now permits clearing both endpoint markers and deleting the
relationship in one mergeable bundle when its explicitly declared final-state predicates hold.
Its transaction-update policy is `always`, and transfer-delete requires both endpoints unlinked.
The prior alpha.59 rejection was an SDK evaluation behavior, rather than an explicit deny in those
rules. The alpha.60 fixture verifies the final deleted relationship and both cleared markers.
Finance's production workflow retains its existing staged unlink sequence; this compatibility
qualification does not relax access checks or the restrictions on deleting referenced endpoints.
