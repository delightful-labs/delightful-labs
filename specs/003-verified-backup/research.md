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
