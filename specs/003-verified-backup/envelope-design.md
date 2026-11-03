# Envelope and integrity implementation design

This slice implements T003 after merged PR #16. It is not a Finance capture or restore workflow.
The user authorized proceeding with review/tests on 2026-11-03 after the implementation was presented.

## Public protocol and ownership

A synchronous preparation factory creates an opaque, single-use seal/open operation. Seal preparation
encodes and detaches the source payload; open preparation bounds and copies the file bytes. Passwords,
raw bytes, parsed payloads and CryptoKeys live only in private operation storage. Requests and result
handles serialize to safe descriptors rather than contents. The shared state machine receives only
the opaque request, a safe mode descriptor and a typed outcome.

Commands are CANCEL and SHUTDOWN. Cancellation records intent and drains the current native crypto
call before cleanup; it does not claim native cancellation. For abrupt owner teardown, request.release()
marks the operation released; pending native work can finish but cannot publish a late result. Cleanup
is deferred until pending calls settle. Actor.stop() alone is not the cleanup protocol.

On success the operation transfers a releasable result handle to the caller. A sealed handle returns
copies of file bytes. An integrity-checked handle returns a frozen payload and its exact-byte digest;
it is explicitly not profile/domain validation, complete source coverage or restore authority. Calling
release clears owned byte buffers/references. It cannot erase caller copies, JavaScript strings or
Web Crypto internals reliably. Result transfer occurs only after the leaf completes; cancellation
before transfer releases the undelivered result too.

## Statechart and leaf operations

```text
claim -> prepare
  seal -> check attachment queue
    pending -> hash one attachment -> check queue
    done, plaintext -> hash payload -> format envelope -> cleanup -> complete
    done, password -> import password -> derive key -> encrypt -> format envelope -> cleanup -> complete
  open plaintext -> hash/compare payload -> parse payload -> check attachment queue
  open password -> import password -> derive key -> authenticate/decrypt -> hash payload
    -> parse payload -> check attachment queue
  open attachment queue done -> build integrity-checked result -> cleanup -> complete
```

Every leaf completion checks interruption before advancing. Every fallible invocation has an error
transition to cleanup. Acquisition cancellation still cleans the acquired operation. Cleanup after
success retains only the transferred result; cleanup on failure/cancellation releases all owned data.
One operation cannot be claimed by two actors, including a second actor starting after completion.

Synchronous encoding/parsing/formatting are bounded pure transforms. Async leaves perform one native
operation each: SHA-256, importKey, deriveKey, encrypt or decrypt. A per-attachment hash leaf owns its
decoded buffer and clears it after native settlement. No loop over files or multi-step crypto flow
is hidden in a promise actor; the chart owns sequencing and the attachment index is a work cursor.

## Format and failure decisions

Use strict Zod envelope variants and the existing duplicate-rejecting bounded JSON parser. File limit
is 64 MiB, payload limit 32 MiB (lower consumer payload limits remain supported). Check canonical
base64 length/padding/pad bits before decoding. Ciphertext limit is payload limit plus the 16-byte tag.
Accept only the specified algorithms, 600,000 iterations, salt/IV lengths and exact header fields
before password derivation. Fresh seal salt/IV use crypto.getRandomValues independently.

Password bytes are exact UTF-8, nonempty, well formed and at most 1,024 bytes; never trim or normalize.
PBKDF2 SHA-256 derives nonextractable AES-256-GCM keys. Import, derive and encrypt/decrypt are separate
states. The exact ordered header tuple is additional authenticated data. OperationError from GCM
opening becomes the same authenticationFailed outcome for wrong passwords and damaged ciphertext.
Other platform errors become a generic crypto failure without retaining raw errors or input.

Plain payload SHA-256 detects corruption, not malicious authenticity. Every attachment is decoded and
hashed individually against its declared digest before a successful seal or checked-open result.
Hash the original opened payload bytes, not reserialized JSON. Domain validation remains a later
profile step. No data writes or network access occur.

## Implemented surface and review status

Branch `feat/backup-envelope`, based on merge `e6e5a9f`. Public subpaths:

- `backup/envelope`: `prepareArchiveSeal`, `prepareArchiveOpen`, typed requests/results and safe errors.
- `backup/envelope/workflow`: `createArchiveEnvelopeMachine`, accepting `{ request }` as actor input.
- Existing `backup/archive` stays the synchronous structural codec and does not import XState.

Hosts create one actor per prepared request, consume its typed completion, and release the returned
archive handle when finished. Before abandoning a running actor, drain CANCEL/SHUTDOWN or explicitly
release its request; never assume stopping an actor clears native work. Preparation errors are safe
exceptions; started operations report typed failures. Unknown protection options are rejected, never
silently treated as plaintext. Failed claims do not release another actor’s operation.

Review scope includes native synchronous throws as well as asynchronous rejection: leaf-local password
and decoded attachment buffers are cleared in both cases. Native results arriving after explicit
release cannot repopulate operation storage. Output remains operation-owned until its completion is
accepted; cancellation in the handoff/cleanup window releases an undelivered handle.

Verification was added after the user authorized proceeding. The matrix includes
independent PBKDF2/AES-GCM vectors, external-format interoperability, plain/encrypted round trips,
attachment and payload corruption, wrong passwords, header/parameter tampering, bounds, opaque
snapshots, concurrent/reused requests, cancellation at each native stage, abrupt release, failed
native calls, output ownership and browser memory/latency behavior. Recorded outcomes and remaining limits follow below.
Source primitives follow the linked Web Crypto specification in the archive contract; SDK/session
or data-storage behavior is unaffected. No application data or secrets are accessed during this work.

## Verification evidence

- All 608 repository unit tests pass across 26 files, including 52 envelope cases and the 82 existing payload cases. The envelope cases cover
  plain/password opening and sealing, exact original-byte digests, real attachment hashes, wrong
  passwords, damaged ciphertext, valid-length salt/IV tampering, rejected parameters before KDF,
  input bounds, buffer copies, result release, concurrent/repeated/fabricated requests, native
  failures and secret-free persisted snapshots.
- A fixed DLF v1 vector in `tests/fixtures/archive-envelope-v1.json` was generated with Node’s
  crypto API without DLF code. It has public test credentials and exact expected bytes/digest.
  Separate live interop tests open Node-encrypted files and decrypt library output via Node’s
  PBKDF2/AES-GCM APIs and an independently constructed authenticated tuple. This checks the DLF
  format and native API wiring; it is not an independent audit of the native crypto provider.
- Tests interrupt each meaningful sealing/opening stage, including cleanup/handoff, and verify
  undelivered resources are released. A deliberately delayed native digest proves cancellation
  drains rather than pretending to abort; explicit request release also cleans after actor.stop().
- A browser bundle consumes public package exports with no source aliases or application session.
  Chromium encrypts/opens and checks an empty attachment, rejects the wrong password and confirms
  secret values are absent from persisted snapshots. Only this browser/small-fixture scope is
  demonstrated; large-file peak memory/latency and additional browsers remain unqualified.
- Public declaration, standalone Node consumer, browser bundle, repository lint/type/format,
  package/strict Publint and Storybook build checks pass. Final-commit CI is checked separately
  before reporting completion.

No application user data, storage, account or schema was accessed or changed. Complete source
coverage, profile/domain validation, file retention and restore remain separate implementation work.
