# Verified backup: source evidence and implementation questions

**Investigated**: 2026-11-03. This is source inspection, not verification of the deployed app or a successful recovery.

## Confirmed requirements and code

Finance’s `specs/001-finance-mvp/spec.md`, approved backup section FR-042–FR-047, already requires owner-only complete workspace exports, optional independent password encryption, no credentials, whole-file validation before writes, and resumable restoration into a new isolated workspace. FR-056 requires verified recovery for released data types. This proposal reuses those requirements rather than inventing financial behavior in DLF.

Inspected Finance checkout: `3eec717` in the rainy-fennel worktree. Relevant source paths:

| Source                                                   | Finding                                                                                                          | Consequence                                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                           | Pins `jazz-tools` to `2.0.0-alpha.59`                                                                            | Initial integration targets that deployed generation; backup must precede any SDK upgrade. Confirm the actual deployment revision before adoption. |
| `src/lib/schema.ts` and `src/lib/schema/transactions.ts` | Consumer-owned schemas; amounts transform between stored integer values and validated application values         | Preserve exact amounts and currencies; generic serialization must handle supported exact integers explicitly.                                      |
| `src/lib/schema/attachments.ts`                          | Files have ordered `fileParts`; byte data is optional in the schema                                              | A file row does not prove contents are available. Check part order, uniqueness, lengths, and actual bytes.                                         |
| `src/lib/schema/integrations.ts`                         | `simplefinConnections` includes legacy `accessUrl`, credential IDs, salts, IVs, and encrypted credential content | A generic dump of every table would export sensitive material. Finance must explicitly allowlist backup data and exclude credential containers.    |
| `specs/001-finance-mvp/spec.md`                          | Archived records and released relationships belong in complete workspace scope                                   | Do not export only visible queries or count a filtered result as complete.                                                                         |

Inspected the actual npm tarball for `jazz-tools@2.0.0-alpha.59`, especially `dist/runtime/db.d.ts` and `dist/runtime/client.d.ts`. Public transaction reads and branch/base snapshot options exist. Their presence does **not** establish a supported full-workspace snapshot, remote completeness, or permission coverage. No ready-made application backup capability has been established by this investigation. Do not copy browser database files and call that an independently restorable application backup.

Local source references are relative to the Finance repository; they are not claims about private deployed records. No user data or browser storage was accessed or modified.

## Recommended division

DLF owns archive versioning and integrity, optional encryption, input bounds, validation sequencing, cancellation/progress, and reusable restore lifecycle contracts. Finance owns an explicit data profile, owner checks, complete queries, financial validation, attachment assembly, relation mapping, new-workspace isolation, and recovered-content comparison. DUI supplies generic presentation; Finance retains its route and consumer strings.

An application profile is deliberately narrower than a universal schema/ORM: no second backend, new data modeling system, or automatic whole-database exporter is required. It uses the consumer’s existing authorized session rather than creating another identity.

## Planning work before implementation

1. Identify the deployed Finance revision and schema. Inventory every released table and relation, including archives, transfers, templates, memberships, and credential exclusions. Record unsupported data explicitly.
2. Establish a coherent, complete read strategy with the pinned SDK. Inspect implementation and qualify its behavior for concurrent edits, pending local writes, remote reads, and permission loss. Do not infer consistency from transaction naming. If the SDK cannot prove a coherent online snapshot, choose an explicit supported source-quiescence procedure or report failure; never silently weaken completeness.
3. Specify a bounded portable encoding for exact integers, date-only values, timestamps, nulls, IDs, and byte attachments, plus integrity and archive/profile version handling. Identify established encryption primitives, password derivation parameters, and independent reader compatibility from primary documentation.
4. Define durable restore operation IDs and mappings, how ambiguous writes are reconciled on the pinned SDK, and how Finance enforces incomplete-workspace isolation. Do not assume a generic local progress counter is sufficient.
5. Define ownership of sensitive buffers, archive input, session references, and cancellation before implementing actors. Do not persist passwords or decoded records in machine snapshots.
6. Implement and review small slices: independent archive creation/inspection, Finance capture, then isolated verified restore. Add required tests after implementation review under repository policy. Verification must exercise the actual integration, not only example profiles.
7. Use the deployed app to save the actual file and recover it into an isolated destination. Only this result satisfies the user’s prerequisite for subsequent identity/storage work.

A readable saved file is useful progress. It must be described as an export until restoration has been demonstrated; implementing only a download button does not finish this feature.

## Planning decisions — 2026-11-03

### Portable archive

**Decision**: bounded uncompressed UTF-8 JSON payload and explicit tagged exact values, inside a plaintext SHA-256 or authenticated password envelope. Native Web Crypto AES-256-GCM / PBKDF2-SHA-256; 600,000 iterations, fresh 16-byte salt and 12-byte IV, 128-bit tag. See [exact proposed contract](contracts/archive-v1.md).

**Rationale**: independent file reading without Jazz/login and no compression/ZIP dependency. Native browser interoperability makes PBKDF2 implementable without adopting a cryptographic runtime. Password work factor is a proposal following [OWASP PBKDF2 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2), not a guarantee about a specific browser. [Web Crypto](https://www.w3.org/TR/webcrypto-1/) specifies the algorithms; [File API](https://www.w3.org/TR/FileAPI/) specifies user-selected file reading.

**Alternatives**: encrypted ZIP adds format/library/security scope; streaming is better for very large libraries but not necessary before real size inventory; Argon2 requires another implementation/runtime despite its memory-hard advantages. Plaintext hashes detect corruption, not malicious authenticity. Initial limits must be qualified and cannot silently truncate real data.

### Capture consistency

**Decision**: first Finance adoption uses a documented quiescent single-user procedure, drains current mutation owners, uses remote graph reads plus local-first comparison, and repeats the remote comparison under that assumption. Do not advertise snapshot isolation or automatic cross-device locking.

**Evidence**: actual alpha.59 `dist/runtime/client.d.ts` documents remote reads without pending writes and local-first with pending writes. `Transaction.readAll` in `dist/runtime/db.js:872` lowers each query with deferred local delivery and `openTransactionId`; `JazzClient.queryInternal` passes options to the runtime. That code does not itself establish a complete frozen remote graph. Branch snapshot options are application-resolved and are not a discovered full-backup snapshot API. Transaction write handles support `.wait({tier:"global"})` and explicit rejection; they are not a generic recovered-pending-write inventory API.

**Alternatives**: local-only dump is incomplete; remote-only export may omit pending edits; using a transaction name as proof of snapshot isolation is unsupported; requiring an upstream upgrade before any archive work contradicts backup-first sequencing. If complete coverage under quiescence cannot be qualified, the Finance operation reports incomplete and the capture strategy must be revised explicitly.

### Restore recovery and isolation

**Decision**: stable new IDs, durable operation/mapping metadata, authoritative reconciliation, explicit incomplete destination and verified activation. Existing workspace creation and local-first reconciliation cannot be reused unchanged.

**Evidence**: Finance `src/lib/schema/identity.ts` has no restore lifecycle marker. Current additional workspace creation seeds defaults and active membership. `src/lib/permissions.ts` uses membership and domain graph invariants; it does not provide a preexisting safe restore lane. `simplefinAccountLinks` requires live connection state, so archive bank provenance cannot simply be inserted into live integration tables. Historical audit metadata cannot impersonate engine authors.

**Alternatives**: a hidden UI flag fails direct route/old-client safety; random IDs on retry duplicate accepted unknown writes; restoring live memberships/credentials violates approved requirements; a single giant transaction has unqualified size/policy limitations. The specific additive policy lane remains an explicit qualification task before Finance destination writes, with no claimed SDK capability until demonstrated.

### Deployment evidence

**Decision**: do not equate the inspected Finance checkout with the actual deployed version. Historical replacement-app verification is useful context, not current evidence.

**Evidence**: status.md records replacement-app verification, current source contains 23 tables, and read-only Netlify project discovery in this session returned `Authentication required`. No private records were read. Current deployment revision, actual supported data types/size, and backend heads still need read-only confirmation before live adoption.

The [plan](plan.md) permits concrete generic implementation now while keeping these consumer acceptance requirements visible. These are not unresolved user-preference questions and do not require inventing answers or stopping all development.

## Restore limitation investigation — 2026-11-03

User requested real-code research and temporary tests before further implementation. The
[specification gate](spec.md#known-restore-limitations-and-implementation-gate) remains in effect.
No production behavior or retry policy was changed during this investigation.

### Method and scope

Inspected the current journal schemas/successor guard and installed `jazz-tools@2.0.0-alpha.59`
implementation. Four temporary Vitest probes passed against a real disposable localhost Jazz
server using the SDK's `createPolicyTestApp`, without mocking settlement or policy decisions.
The fixture uses a memory client: a fulfilled local-tier wait here does **not** qualify browser
on-disk persistence. A separate temporary Chromium persistent-profile probe checked graceful browser
process restart against the built public journal exports. All data, profiles and namespaces were
synthetic/disposable; no live application or Finance data was used.

### Observed results

| Situation                                                                                        | Real result                                                                                                                                                             | Consequence                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Insert two rows in one transaction while insertion permission is denied                          | Local-tier wait fulfilled; global wait produced `PersistedWriteRejectedError` with `permission_denied` and the original transaction ID. Remote read showed neither row. | Local settlement and server acceptance are separate. This is a definitive failed attempt, not a timeout.                                                          |
| Restore permission, then insert the exact same contents at the same row IDs in a new transaction | New transaction accepted; exactly two remote rows existed. Waiting again on the rejected transaction still returned `permission_denied`, even after permission repair.  | Jazz supports this ordinary retry. It needs a new transaction, not a new destination or mapping table.                                                            |
| Repeat those already-accepted inserts at the same IDs under the insert-only test policy          | Replay was rejected with `permission_denied`; the two accepted rows remained.                                                                                           | Stable IDs alone do not make blind replay succeed. Reconcile an uncertain result before issuing another write. This observation is specific to the tested policy. |
| Disconnect transport, issue one write, then reconnect                                            | Local-tier wait fulfilled. Global wait remained pending during the 40 ms disconnected observation and accepted after reconnect. Only one write was issued.              | Ordinary disconnection can resume the original write; it should not automatically become a definitive rejection/new attempt.                                      |
| Query a known existing row that the caller's read policy hides                                   | Admin insertion was confirmed, but a remote-tier lookup by ID returned null for the restricted caller.                                                                  | Remote null alone cannot prove absence. Recovery needs sufficient read authority over the expected destination.                                                   |
| Close Chromium completely and launch it again with the same disposable profile and origin        | The public journal API loaded the exact revision-2 record, mappings, issued marker, known transaction ID and local/remote observations.                                 | Graceful same-profile process restart works in this probe. Crash/power-loss and actual Jazz write recovery were not tested.                                       |

The process-restart probe first persisted an unobserved issuance, then its observed settlement in a
separate journal update, as required by the admission guard. Its transaction ID was synthetic: the
probe qualifies journal retention, not resumption of a real Jazz transaction.

### Confirmed journal mismatch

Temporary pure probes against the actual successor guard showed:

- `local: persisted, remote: rejected` cannot advance to a new issuance and cannot turn into accepted
  settlement on the original transaction. The latter preserves a correct historical fact; blocking
  every new attempt prevents the working Jazz retry above.
- `local: persisted, remote: unobserved` with a known transaction ID can advance to acceptance for
  that same transaction. It cannot advance to a new issuance.
- An issuance with both observations unobserved and no transaction ID can increase its issuance
  counter. That data transition supplies no proof that reissuing a destination write is safe.

Source: `src/lib/backup/restore-journal-successor.ts` (`retains`, `unobserved`, final reissuance gate)
and `src/lib/backup/restore-journal-schemas.ts` (`settled`). The model currently treats settlement
observations as permanent properties of the planned write rather than of an individual attempt.

### SDK source constraints

Installed SDK source supporting these observations:

- `node_modules/jazz-tools/dist/runtime/client.js`: `rejectionFromRuntimeWaitError`,
  `PersistedWriteRejectedError`, `WriteHandle.wait`, `normalizeTransactionWaitError`. Generic thrown
  errors are not automatically structured authority rejections.
- `node_modules/jazz-tools/dist/runtime/native-runtime/native-runtime-adapter.js`: constructor creates
  a transaction-owner `writes` Map; `recordWrite` registers live handles; `waitForTransaction` looks
  them up and rejects unknown transaction IDs. The inspected path does not establish a public way
  to reconstruct a wait handle from a persisted transaction ID after restart. That is a source-based
  constraint, not a tested claim that all SDK recovery paths are impossible.
- `node_modules/jazz-tools/dist/runtime/client.d.ts`: `ReadTier.Remote` excludes pending local writes;
  `DurabilityTier` distinguishes local and global acceptance. Read policy still applies, as tested.
- `node_modules/jazz-tools/dist/testing/policy-test-app.js`: the real policy fixture deploys a
  catalogue and uses native transaction settlement; its client storage is explicitly memory.

### Accepted behavioral direction — 2026-11-03

Keep restore identity, destination IDs and mappings stable. Distinguish a planned write from its
current transaction attempt. The user approved permitting a new attempt after a definitive rejection once the failure
is corrected and authority is checked again, while retaining evidence of the rejected attempt.
An uncertain outcome should continue waiting or reconcile actual content; a generic exception or
permission-filtered null must not authorize replay. This does not require cross-device recovery,
a generalized retry engine or an unbounded attempt history.

The user confirmed continuation of the same restore after correcting access. Before implementing,
settle how that action is initiated and how the journal distinguishes attempts. Recovery of
real pending Jazz writes after restart still needs a qualified destination read/reconciliation path;
the journal by itself cannot supply it. Implementation remains paused.

Temporary probe source/results are retained locally under `/tmp/dlf-restore-retry.research.test.ts`,
`/tmp/dlf-restore-retry-evidence.json`, `/tmp/dlf-restore-retry-research.log`,
`/tmp/dlf-journal-restart-research.mjs` and `/tmp/dlf-journal-restart-evidence.json`. They are not part
of the committed test suite and may disappear with temporary-directory cleanup. This section retains
the findings and their qualification limits.

## Persistent Jazz write recovery investigation — 2026-11-03

The user authorized three real-browser follow-up cases before production changes: an accepted write
whose journal update was missed, a pending write at browser close, and lost read permission during
recovery. All three temporary probes completed against `jazz-tools@2.0.0-alpha.59` and Chromium
148.0.7778.96. Production code and the implementation pause are unchanged.

### Actual setup

A disposable real Jazz authority hosted a minimal schema: text notes carrying a restore operation ID,
and an administrator-controlled gate for note-read access. A browser used public `createJazzSession`
with `initial: 'local-first'`, persistent storage and the SDK's real SharedWorker/WASM assets. The
SDK's default browser account store retained the identity across process restarts. A separate backend
administrator connection checked remote rows independently of the browser's read policy.

The browser also used the built public DLF journal APIs. Each operation had stable note/destination
IDs and an issued checkpoint before the actual SDK mutation. The accepted case deliberately omitted
the later journal update; the pending case recorded its real transaction ID and local persistence.
The process was closed without application `session.close()`, then Chromium was launched again with
the same disposable profile and origin. The restarted application issued **zero** replacement writes.
Every browser lifetime, server, listener and temporary profile was owned by the probe's cleanup.

| Case                                                                                             | Observed result                                                                                                                                                                                                                                                                                          | What it establishes                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write globally accepted before close; journal still says issued with unobserved settlement       | Same identity and exact stale journal loaded after restart. A remote read returned the exact expected note text and operation ID. No replacement write was issued.                                                                                                                                       | A missed checkpoint does not require replay when actual destination contents are readable and match.                                                                                  |
| Transport disconnected; write reached local persistence; browser closed before global acceptance | Administrator reads showed no destination row both before and immediately after browser close. After reopening, the exact journal remained and the SDK delivered the stored write to the authority. The expected remote contents appeared exactly once, with zero application-issued replacement writes. | The persistent browser SDK recovered this locally persisted pending write across graceful process restart. This is stronger evidence than the earlier memory-client disconnect probe. |
| Read permission revoked before restart while accepted row still exists                           | Browser remote read returned null; public `canRead` returned `unknown`. Administrator read confirmed the row still existed. Restoring permission made the same exact row readable again without another write; `canRead` still returned `unknown`.                                                       | The browser API did not distinguish hidden from absent through permission advice in this setup. Null plus unknown advice cannot authorize reissuance.                                 |

### Important distinction: destination contents versus transaction fate

A remote content match establishes that the expected data is present within the tested read scope.
It does not reconstruct the old JavaScript write handle or independently establish the original
transaction's fate. The current journal has settlement receipts but no separate completion basis
for a step reconciled from matching destination contents. The eventual representation must not turn
a content observation into an invented transaction-acceptance receipt.

This is in addition to the earlier confirmed-rejection problem: the same planned write can require a
new transaction attempt after a definitive rejection, while preserving its destination/mappings and
the fact that the previous attempt was rejected. These are the two bounded journal representation
questions to discuss before changing the schema; an unbounded retry history is not needed.

### Permission-advice source check

`Db.canRead` delegates to `JazzClient.requestReadPermissionAdvice`, then the native runtime adapter.
`withPermissionAdviceTimeout` in
`node_modules/jazz-tools/dist/runtime/native-runtime/native-runtime-adapter.js` explicitly permits
`unknown` for unavailable transport, request errors or its two-second advice timeout. The observed
browser results were `unknown` both while the row was hidden and after access was restored. This
investigation does not establish which fallback caused those results or that permission advice is
universally unavailable. It establishes that it cannot be assumed definitive for this browser path.

### Supported conclusions and remaining limits

- When the expected destination contents are remotely readable and match, recovery can avoid another
  application write. Full restore still needs comparison of the entire planned data, not only this note.
- When a write is locally persisted and pending, allow the SDK's durable worker to recover/sync it.
  Do not infer rejection or issue a second write merely because the journal has no global receipt.
- When expected contents cannot be read and current access is unknown, retain the operation and
  mappings and leave it unresolved. Retry observation after access/connectivity is restored; do not
  automatically recreate or overwrite data. A qualified way to establish absence under full read
  authority is still needed before any replay based on absence.
- These probes use graceful browser close/reopen, not forced termination or power-loss. They do not
  qualify clearing browser data, cross-browser/device recovery, concurrent restore owners, complete
  Finance policy/isolation, attachment/relationship recovery or an end-to-end verified restore.
- The note contents were compared directly. Journal intent hashes came from the synthetic fixture;
  the probe did not validate a real archive or claim a complete content-digest proof.

No expanded platform matrix or production fix was added. The next discussion should settle the
smallest distinction between planned-step completion, current transaction attempt, rejected-attempt
evidence and reconciliation from observed contents, with unknown access remaining unresolved.

Temporary source is archived locally in `/tmp/dlf-real-jazz-research/` (schema, browser leaves,
resource-owning harness and Vite config). Results are in `/tmp/dlf-real-jazz-restart-evidence.json`
and `/tmp/dlf-real-jazz-restart.log`. These temporary files are outside the normal test suite and are
not durable project artifacts; this section preserves the evidence and limits.
