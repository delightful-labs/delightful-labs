# Finance legacy account-storage bridge

## Scope and machine-first review

Extend the existing native storage capability with a related raw snapshot and
admitted earlier-key reads/writes. These are native leaf operations: no account
selection, root removal, read/transform/write workflow, lock acquisition, or SDK
startup is performed in Window. The reviewed account-store machines own those
states and decisions. A shared pure namespace predicate keeps Window admission
and worker eligibility consistent without importing Jazz runtime code into Window.

Window binds the primary key, environment suffix and legacy registry pathname
at host construction. Every earlier-key read/write rechecks that binding before
accessing storage. The worker cannot expand its scope through RPC payloads.
The raw snapshot includes all eligible keys, including invalid values, so invalid
or ambiguous inventory cannot become a false claim that identity is absent.
Oversized/incomplete inventories fail rather than silently truncate.

Bounds: 4,096 origin storage slots scanned, 128 eligible entries, 1 MiB per
account value, 2 MiB aggregate snapshot characters including keys, and the existing
65,536-character key bound. The snapshot is collected synchronously in Window;
it is not an atomic cross-tab snapshot. The existing worker Web Locks and fresh
legacy read before scrub remain required. Values are never logged.

## Integration and qualification

This remains inactive infrastructure. A worker-tree SDK AccountStore facade,
admission/shutdown supervision, and session/workspace handoff still remain.
Neither an SDK owner nor a second persistent replica is started by this batch.

After implementation approval, `pnpm test:worker-host` passes all 36 native
bridge cases on Node 24.22.2, including 12 legacy-storage cases. The standalone
strict type check passes. `pnpm test:worker-state` also passes all 11 cases,
including the 100-run generated custody campaign. Native coverage includes: valid inventory, malformed
and ambiguous legacy values preserved as facts, primary-key binding mismatch,
foreign environment/path rejection before I/O, bounded inventory failure rather
than truncation, legacy write acknowledgement/replay and uncertain-write handling.
The shared pure namespace extraction is covered by the native cases and the
account-store campaign. Browser cold persistence and multi-tab
identity reuse remain required for eventual activation.
