# Data Model: Manual SimpleFIN Bank Sync

## Connection

Retain the required legacy accessUrl column shape for migration compatibility; new writes use only an empty-string sentinel, enforced by Jazz permissions. It never receives a usable credential. Add ownerId and versioned encryption metadata: credentialId, prfSalt, iv, ciphertext. Bind the envelope to ownerId, organizationId and row ID through AES-GCM additional authenticated data. Existing unprotected records require reconnection and cannot be used for provider requests. A missing envelope indicates waiting for replication or reconnection, never an unlocked connection.

Metadata contains active/revoked/error state, last manual attempt time, outcome and counts. Status never implies this device can decrypt. Owner-only mutation requires active owner/admin organization membership; read access to ciphertext cannot grant decryption.

## Account mapping

Scope links to organization and connection; provider identity includes institution identity and account ID. Map only active same-organization local accounts. Reconnection preserves mappings and imports. Disconnect removes the encrypted envelope and revokes the application connection without deleting finance data; provider-side revocation remains necessary for previously copied credentials.

## Imported transactions

Use existing transaction fields, source=simplefin and a stable composite external identity. Derive the row UUID from organization and provider institution/account/transaction identity, independent of local mapping or connecting device. Repeated sync does not update already imported finance data. Deterministic IDs prevent multiple rows from concurrent offline imports; concurrent conflicting content on the same row remains subject to Jazz resolution.

## Secret lifetime

Setup tokens, decrypted URLs, PRF outputs and CryptoKeys are operation-scoped only. Never persist or log them. Zero mutable PRF buffers after key derivation. Browser memory collection cannot be guaranteed; drop all application references when an operation terminates. Each operation requires a new verified assertion.
