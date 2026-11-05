# T007 — deployed Finance inventory

**Inspected 2026-11-05, 10:56–11:02 UTC. Status: T007 complete for the selected workspace and
existing browser session.** Frontend assets, backend schema/policy identity, released types, owner
authority, scoped record sizes and observable pending-write state were inspected read-only. This
is inventory evidence, not a backup, capture qualification or recovery rehearsal. No individual
Finance rows, account/workspace identifiers, credentials or recovery material are included here.

## Deployment identity

Read-only Netlify project/deploy lookups now succeed, superseding the 2026-11-03 authentication
failure. The published deploy was rechecked after the live inventory and remained unchanged.

| Item               | Observation                                                                        |
| ------------------ | ---------------------------------------------------------------------------------- |
| Production origin  | `https://finance.delightfullabs.com`                                               |
| Netlify project    | `delightful-finance`, `a97b99a1-844a-4c86-9655-f797c360246d`                       |
| Published deploy   | `6aea8e723a9b9fba60621b7a`, production/main, ready                                 |
| Published at       | `2026-11-04T01:47:18.621Z`                                                         |
| Frontend commit    | `31f70cb3c5603dac244debe7c9fe726c60014a89`                                         |
| Immutable frontend | [Netlify deploy](https://6aea8e723a9b9fba60621b7a--delightful-finance.netlify.app) |
| Served Jazz app    | `302f9f87-1a3d-4c6e-a96a-7b2c1b70a641`                                             |
| Served Jazz server | `https://v2.sync.jazz.tools/`                                                      |
| Released SDK pin   | `jazz-tools@2.0.0-alpha.59` in the deployed commit's package and lockfile          |

The Finance checkout is clean at that exact commit. Public GETs fetched HTML and referenced
JavaScript without executing the application or creating a session. The configuration chunk,
schema-bearing chunk and service worker have identical SHA-256 bytes at production and the
immutable deploy URL:

| Asset                                | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `/_app/immutable/chunks/DLBfmG76.js` | `d021e541f6bff83c18b5c746eff9c6e1eaa3becf66964f7bf415a0274e703e1c` |
| `/_app/immutable/chunks/B_SXcnbO.js` | `e0a93f60b4a2d281b4f25f3ae29a87e9dca1f31f0e219cb632830c27ed032edd` |
| `/service-worker.js`                 | `a2239522fc09e89045a6d967e2d2f388acc8b37100d0f6dcd9d889e8068fa2b5` |

The config chunk and service worker identify the same Jazz namespace. The schema-bearing chunk
includes the independent Checks, legacy Check references, bank-sync logs and batch/template tables.
The existing signed-in Chrome tab loaded these configuration/schema chunk paths and the same
frontend entrypoint. Its runtime schema and imported app schema have the same canonical JSON
SHA-256 as the deployed source: `8bf12115c8b0e95922cf1d742be326809a35920ccb0cd029e150704bf83584ca`.
No service worker controlled this tab. No reload, update, new session or identity was requested.

## Source schema and policy baseline

The installed alpha.59 SDK's `loadCompiledSchema('src/lib')` and `computeSchemaHash` were used
locally, without invoking deploy, a build, a development server or snapshot-writing export commands.

| Baseline                             | Result                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| Compiled source table count          | **22**, including retired/denied tables; the earlier count of 23 was inaccurate |
| Structural source hash               | `e5a4d82f60137eccad6e82481f77c943177118ca1d722ddda28b896cd5f5cc0a`              |
| Normalized source policy SHA-256     | `a1f1758cf4135bfea3be493bf99eb673b19d6090c573a3b74a8e09c60eaff6e6`              |
| Policy diagnostic                    | `transactionTags` has no explicit update policy; updates are denied             |
| Current server catalogue/head/bundle | Verified below; matches the source baseline                                     |

The policy fingerprint is SHA-256 of UTF-8 compact `JSON.stringify` of alpha.59
`normalizePermissionsForWasm(compiled.permissions)`, with object keys sorted recursively and array
order retained. It is an investigation fingerprint, not a Jazz permission-head identifier.
Authenticated GETs returned seven stored schemas and current permission head **version 8**, targeting
exactly the structural source hash above. The SDK's `wasmSchemasEqual` confirms equality, and the
server has exactly the same 22 table names. The permission bundle's head matches the independently
read head. Head identity was unchanged through the final 11:01:34 UTC check.

The normalized server policy JSON SHA-256 is
`a4f8e4e4b649dcc6b984c59103699575f4bf9807a9f3649c9a1b14b144e0ac39`. It differs from the
source JSON only in omitted versus explicit-null optional `max_depth` / `scope` defaults. Removing
only those null defaults yields the source policy fingerprint above, with **zero mismatched policy
tables**. Permission head/bundle identifiers and catalogue timestamps are retained in a private local
verification record. These checks do not establish the managed Cloud server binary revision or
qualify application runtime behavior.

Historical Finance `specs/001-finance-mvp/status.md` verifies this namespace's former 19-table
schema/head. The authenticated checks above supersede that historical checkpoint for current
structural/policy identity. The local `.env` targets a different app; the live target was bound to
the verified public config and the existing session, using the user-supplied private credential.

## Released graph coverage

Sources are pinned to the deployed commit:
[schema composition](https://github.com/delightful-labs/delightful-finances/blob/31f70cb3c5603dac244debe7c9fe726c60014a89/src/lib/schema.ts),
[schema modules](https://github.com/delightful-labs/delightful-finances/tree/31f70cb3c5603dac244debe7c9fe726c60014a89/src/lib/schema),
and [permissions](https://github.com/delightful-labs/delightful-finances/blob/31f70cb3c5603dac244debe7c9fe726c60014a89/src/lib/permissions.ts).
These 22 rows inventory released types and required scope. They do not establish that any given
type is empty, readable in production or already supported by an implemented Finance profile.

| Table                         | Scope and inventory requirements                                                                                                                                                               | Backup treatment from the adoption contract                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`               | Selected workspace; name, kind, default currency, owner identity                                                                                                                               | Settings and inert source identity; new destination ownership                                                                    |
| `organizationMembers`         | All memberships for the workspace, including optional profile references, roles and account-access mode                                                                                        | Inert provenance; never reactivate grants                                                                                        |
| `profiles`                    | Only profiles referenced by workspace membership and required attribution; profile initialization provenance is not authority                                                                  | Minimal allowlist; avatars and unrelated profiles excluded by default                                                            |
| `accounts`                    | Workspace ID; include archived accounts, kind and currency                                                                                                                                     | Exact domain values and archived state                                                                                           |
| `accountMemberships`          | Workspace ID and account closure; user, access and delete grant                                                                                                                                | Inert provenance; never reactivate grants                                                                                        |
| `categories`                  | Workspace ID; include archived/system categories and transaction kind                                                                                                                          | Exact domain values and archived state                                                                                           |
| `tags`                        | Workspace ID; include archived tags, required kind and optional category link                                                                                                                  | Exact domain values and relationships                                                                                            |
| `transactions`                | Workspace ID; every account/date/kind, without UI filters; amounts/currencies, date-only text, description/memo, payment method, source/external ID, category, batch, Check and transfer links | Exact supported values/references; detect every legacy `checkDetailsId`                                                          |
| `transactionTags`             | Workspace ID plus transaction/tag closure                                                                                                                                                      | Preserve association records                                                                                                     |
| `checks`                      | Workspace ID; account, number/date, payer/bank/memo and reverse transaction relationships; include currently unassociated Checks                                                               | Preserve independent Checks and exact relationships                                                                              |
| `checkDetails`                | Retired table; source policies deny every operation, including owner reads                                                                                                                     | Detect visible transaction references and reject unsupported coverage; denied reads cannot prove absence                         |
| `internalTransfers`           | Workspace ID; both transaction endpoints, account IDs and per-side amounts/currencies, plus legacy optional amount/currency fields                                                             | Preserve exact available variants and cyclic relationships; do not synthesize missing values                                     |
| `transactionBatches`          | Workspace ID; include records even where UI is absent                                                                                                                                          | Preserve optional name and transaction relationships                                                                             |
| `batchTemplates`              | Workspace ID; include records even where UI is absent                                                                                                                                          | Preserve required name                                                                                                           |
| `transactionAttachments`      | Follow every scoped transaction; table has no workspace column                                                                                                                                 | Preserve transaction/file associations                                                                                           |
| `files`                       | Follow attachment file IDs and validate `transactionId`; optional account/workspace columns are not populated by the normal uploader                                                           | Preserve name, MIME, declared length and complete original bytes; workspace-column filtering alone would omit files              |
| `fileParts`                   | Follow file IDs; inspect every part index, declared length and optional byte payload                                                                                                           | Require contiguous complete parts, exact byte lengths and full reassembled bytes                                                 |
| `uploads`                     | Operational placeholder; source policies deny every operation                                                                                                                                  | Exclude jobs; denied/empty queries cannot establish that attachment work is drained                                              |
| `simplefinConnections`        | Workspace ID; admin-readable under source policies                                                                                                                                             | Explicit nonsecret reference only; exclude `accessUrl`, credential version/ID, PRF salt, IV, ciphertext and arbitrary error text |
| `simplefinAccountLinks`       | Workspace ID; account/connection links and provider account/org references, optional balance/date                                                                                              | Allowlisted inert historical provenance; no live reconnection                                                                    |
| `simplefinSyncAttempts`       | Workspace ID; connection/initiator/time, outcome/settlement, safe failure enum and counts                                                                                                      | Sanitized inert history; never rerun import or activate a connection                                                             |
| `simplefinSyncAccountResults` | Workspace ID and attempt/account closure; account name, outcome, safe failure enum and counts                                                                                                  | Sanitized inert history and relationships                                                                                        |

Preserve supported source audit attribution separately from destination audit fields. There is no
released allocations table. Full engine history and deleted rows are outside the approved current
application graph. Hidden orphan files and denied legacy rows cannot be declared absent from
policy-filtered client results. Reconcile any newly discovered backend type before claiming coverage.

## Live workspace and size measurements

The user connected the existing Finance tab and supplied a mode-600 private credential file.
No login, recovery, new identity or source mutation was needed. The remote organization owner
matches the session account; exactly one matching membership is `owner` with account access `all`.
Owner authority was checked again at 11:01:46 UTC. Private aggregate evidence is retained outside
Git in `/private/tmp/t007-finance-workspace-inventory.json`; authenticated catalogue evidence is
in `/private/tmp/t007-finance-backend-inventory.json`. Neither contains credentials or row contents.

The graph inventory ran from **10:58:44.680 to 10:58:55.153 UTC**. It performed a remote pass,
a local-first pass and another remote pass. All 20 accessible table projections matched exactly
between local and remote and across the two remote passes after sorting records by ID. Comparisons
included supported fields and source audit attribution where selected. Connections used an explicit
nonsecret projection; profile avatars were excluded. No plaintext/encrypted credential columns or
arbitrary provider error text were read. Matching passes do not establish snapshot isolation,
writer quiescence or edits held on another device.

Each query had an explicit 50,001-row sentinel limit and failed inventory if reached; no query
reached it. ID traversal used batches of 200 with an aggregate sentinel check. No screen filters,
date ranges or archive exclusions were applied. The scoped graph has **633 projected records**:

| Type                          | Remote rows |  Local rows |
| ----------------------------- | ----------: | ----------: |
| `organizations`               |           1 |           1 |
| `organizationMembers`         |           1 |           1 |
| `profiles`                    |           1 |           1 |
| `accounts`                    |          22 |          22 |
| `accountMemberships`          |           0 |           0 |
| `categories`                  |          13 |          13 |
| `tags`                        |           7 |           7 |
| `transactions`                |         521 |         521 |
| `transactionTags`             |          12 |          12 |
| `checks`                      |           0 |           0 |
| `internalTransfers`           |           1 |           1 |
| `transactionBatches`          |           0 |           0 |
| `batchTemplates`              |           0 |           0 |
| `transactionAttachments`      |           0 |           0 |
| `files`                       | 0 reachable | 0 reachable |
| `fileParts`                   | 0 reachable | 0 reachable |
| `simplefinConnections`        | 1 sanitized | 1 sanitized |
| `simplefinAccountLinks`       |          21 |          21 |
| `simplefinSyncAttempts`       |           5 |           5 |
| `simplefinSyncAccountResults` |          27 |          27 |

There are zero archived accounts/categories/tags and zero visible legacy Check references. Checked
account/category/tag/Check/batch/transfer endpoints and bank-link/attempt/result relationships have
zero missing references. No attachment association was reachable from any transaction, so the scoped
attachment bytes, maximum file size and part bytes are all **zero**; no file bodies were fetched.
These are application-graph counts, not a physical orphan-row census. `checkDetails` and `uploads`
remain policy-denied and were not queried or assigned a fabricated zero count. An unsupported visible
reference would still prevent a complete capture.

The sum of the 20 UTF-8 comparison-array encodings was **672,633 bytes** (about **0.64 MiB**), of
which transactions contributed 590,538 bytes. This encoding sorts object keys and records, retains
explicit representations for undefined/bigint/date/byte values, and includes selected source audit
fields. It is a reproducible projection-size measurement, **not the size of a Finance backup**.
Profile wrappers, relationship mappings, archive metadata and encryption framing do not exist yet
for Finance; T008 must measure the actual encoded archive. No attachment base64 expansion applies
to this observed graph because it has no reachable attachments.

### Pending local writes and platform

Read-only observations at 10:57:43 and 11:01:46 UTC found zero open transactions, local settlements,
streaming mutations, tracked write handles, transaction preparations and pending mutation-error
events in the existing foreground runtime. The projected local-first graph had zero differences
from the remote graph. No flush, wait-for-write, disconnect, drain or mutation API was invoked.

This establishes **no observed tracked pending writes or supported projected graph differences in
this session**. It is not an enumeration of the engine's recovered transaction ledger, a statement
about credential/avatar fields that were intentionally not compared, or a guarantee about other
browsers/devices. T008 still needs explicit writer admission/quiescence and drain qualification;
inventory does not substitute for that capture protocol.

The observed platform is desktop Chrome 157 on macOS (`MacIntel`), 12 reported logical processors,
16 GiB reported `navigator.deviceMemory` and a 1440×1122 viewport. Browser-reported hardware values
are approximate. The tab was not service-worker-controlled. These identify the observed device,
not a performance or phone qualification.

## Attachment bounds for future qualification

[Released attachment selection](https://github.com/delightful-labs/delightful-finances/blob/31f70cb3c5603dac244debe7c9fe726c60014a89/src/lib/domain/transaction-attachments.ts)
accepts JPEG, PNG and WebP inputs up to **10 MiB each and five images per transaction**. Before
storage, the normal attachment actor fits images within 2048×2048 and re-encodes using the source
MIME and quality 0.85. The stored `files.sizeBytes` is the resulting blob's size, not the selected
input size. Therefore the 10 MiB selection limit alone does not prove an oversized stored file.
The uploader uses 256 KiB parts and locally settled writes; UI success alone cannot prove remote
acceptance or complete byte coverage. Profile avatars are a separate excluded-by-default binary
field, not transaction attachments.

Backup limits remain 8 MiB per attachment, 16 MiB aggregate raw attachments, 32 MiB decoded payload,
64 MiB outer file and 50,000 records. The observed 633-record, zero-attachment graph provides no
reason to expand attachment bounds. Future image-heavy data still needs actual stored-byte and
encoded-size qualification: input dimensions/quality are not an archive byte guarantee. Do not
omit, resize or downsample existing stored bytes to make a backup fit. T004 should qualify the
measured record workload; T008 must measure the completed Finance profile/envelope before success.

## Access history and validation

Three earlier browser connection attempts timed out. The user's later connection succeeded and
all subsequent workspace reads used the existing signed-in tab. Automatic approval review had
rejected listing all Netlify environment variables because of possible deployment-secret exposure;
that broad request was never retried. The user instead explicitly supplied the targeted private
Jazz credential file. Only authenticated GET catalogue requests used it; it was never sent to the
browser, printed or added to Git.

Read-only Netlify metadata, production/immutable asset comparisons, local schema compilation,
authenticated backend comparison, scoped local/remote data comparisons and runtime observation
complete T007. Local evidence files are mode 600. No source-data writes, pending-write flushes,
login/session creation, schema publication, deployment, storage reset or implementation tests were
performed. Ordinary Jazz reads may populate the existing browser cache; that is not a source-row
mutation. The Finance working tree remains unchanged.

T004 performance qualification, T008 Finance profile/capture/interaction, T009 isolated restore and
T010 retained-file recovery remain separate open tasks. Repeat this inventory if deployment,
permissions, workspace data, session or device changes before actual adoption. A download and a
verified isolated restore are still required before later identity/storage changes.
