# Research: Manual SimpleFIN Bank Sync

## Authoritative references

- https://www.simplefin.org/protocol-v1.html
- https://beta-bridge.simplefin.org/info/developers
- https://github.com/w3c/webauthn/blob/main/explainers/prf-extension.md

Claim is a POST to the decoded setup token URL. Access URLs contain Basic Authentication credentials. Requests require HTTPS; account discovery uses balances-only=1; positive amounts represent deposits. Transaction IDs are unique within provider accounts. Unsupported currencies and pending records must be omitted rather than approximated.

WebAuthn PRF requires an actual successful evaluation, not merely passkey registration. Derive encryption keys with HKDF, use fresh AES-GCM IVs, and authenticate scope metadata. Perform two assertions and an encryption round trip before the irreversible claim. A synced passkey and replicated ciphertext are separate requirements.

Use a restricted stateless relay because browser CORS behavior varies; do not attempt direct-then-relay retries for one-use claims. Never follow provider redirects. Only SimpleFIN Bridge is supported initially.

Use deterministic Jazz UUIDs for import identity rather than a pre-read alone. Existing-row reads preserve local edits; same-ID concurrent inserts must be covered in subsequent integration validation.

## Validation still required

Physical-device browser/OS/password-manager matrix, including locally synced versus phone/QR flows; production encrypted Jazz replication; provider live CORS/relay integration; concurrent Jazz deterministic inserts. No cross-device support claim until these pass.
