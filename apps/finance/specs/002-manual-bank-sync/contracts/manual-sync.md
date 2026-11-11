# Manual Sync Contract

Connecting user must have active owner/admin membership. The signed-in user must match the connection owner. Passkey possession never grants organization access.

Connect: explicitly submit token, verify PRF encryption round trip, claim once, encrypt and persist, discard secrets. Never fetch accounts or transactions during setup. Distinguish consumed-token persistence failures from claim failure.

Discover: explicit action, fresh passkey verification, GET accounts with balances-only=1. Never import transactions from discovery.

Sync now: explicit action, fresh passkey verification, one bounded GET accounts and one import attempt. Reject repeated clicks while running. No automatic retry. Revalidate identity, organization, connection and mapping before persistence.

Relay: same-origin POST JSON only; allowlisted HTTPS SimpleFIN Bridge destinations; no redirects, caches, retained credentials or logging. The relay forwards requests but does not authorize Jazz writes or store credentials.

Outcomes: locked, waiting for encrypted replication, unavailable passkey, disconnected, provider failure, success or partial with imported/existing/omitted counts. Never display raw provider error bodies. Disconnect removes the envelope; reconnect with a new token/passkey preserves imported data and mappings.
