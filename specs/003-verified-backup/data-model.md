# Backup data and lifecycle model

See [archive contract](contracts/archive-v1.md) for exact portable fields and validation.

## Durable data

**Archive**: immutable encoded bytes identified by archive ID and SHA-256 of the exact decoded payload. Re-encrypting the same payload changes envelope bytes; restore identity binds the payload digest and profile, not encryption randomness.

**Restore operation**: consumer-owned durable metadata: operation ID, payload digest, profile ID/version, restoring identity, destination workspace ID, stable mapping seed or explicit mapping entries, expected graph fingerprint, next work descriptors, and status (`incomplete`, `verifying`, `complete`, `conflict`). No password or decoded financial values belong in this journal. Its data has permissions and is not public telemetry.

**Mapping**: source `(record type, ID)` to allocated fresh destination ID. Allocate and durably retain the complete mapping before corresponding writes; never generate replacement IDs after an unknown outcome. Finance source audit and bank provenance remain inert records with mapped references, separate from live memberships or integration tables.

**Batch receipt**: operation ID, batch identity, expected mapped IDs and expected content digests, confirmed transaction identifier when supported, and settlement. A receipt missing after an accepted write is not proof of absence. Reconcile actual authoritative rows and fields using stored expected identities.

## Ephemeral resources

**Validated archive resource**: immutable owned payload and verified attachments plus profile validation result, addressed by an opaque handle. It remains bound to exact bytes; the consumer cannot replace data after validation. Release invalidates the handle. Restore uses this resource rather than re-reading a mutable input file. After restart the file/password must be supplied again and match the journal payload digest before resuming.

**Binding**: identity/session/workspace and monotonically new generation token. All child reports carry this token. Returning A → B → A does not accept old A results.

**Capture lease**: consumer-maintained ownership of write admission suspension, drain results, quiescence assumptions, and source access observation. It does not represent a server snapshot. Release resumes ordinary source operations only after owned reads and cleanup settle.

## Outcome variants

Export distinguishes unsupported/incomplete source, archive produced, file handoff, cancellation, access loss, and failure. File validation distinguishes invalid envelope, authentication failure, unsupported profile, generic integrity valid, and domain validated. Restore distinguishes not started, incomplete with recoverable operation reference, conflict, and verified complete. Local and global settlement remain explicit facts, separate from lifecycle state.

## Destination invariants

Zero destination writes before the entire archive passes generic and consumer validation. New workspace only; no starter categories. New owner is the current identity, not an archived subject. Existing source data is immutable to this operation. Incomplete destinations cannot enter ordinary Finance flows, and historical grants never reactivate. All restored relationships point to mapped destinations or explicitly inert external references. Activation occurs only after exact content comparison and authoritative confirmation; a lost activation response enters reconciliation.
