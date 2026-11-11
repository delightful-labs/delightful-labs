# Shared SDK runtime patch reconciliation

Both apps use `jazz-tools@2.0.0-alpha.60` but carry distinct runtime patches.
The root patch combines their existing fixes; it does not upgrade the SDK or
patch XState. Original commits, patch digests and every resulting file digest
are recorded in `sdk-patch-reconciliation.json`.

Nonconflicting hunks retain both sources' changes, including worker-host
transport/generation control, worker-compatible runtime detection, serialization
of runtime configuration, retained-worker lifecycle fixes, Vercel process options,
Finance's session/broker-core fixes and Clipper's explicit extension-origin and
guest-account admission handling.

The three overlapping files (runtime module, declaration, bundled broker worker)
differ in parameter names and formulation of refreshed peer-proof admission.
Finance selects the fresh proof after checking its app/author against the owner;
Clipper pins the owner's app/author and substitutes only the freshly verified
token after the same equality checks. The latter formulation is retained
consistently in module and bundle. It refuses a different owner/audience and
still passes the token through native signature/expiry validation. The separate
Finance broker-core module passes the proof positionally and is compatible.
This resolution follows ownership semantics, not age or repository precedence.

Source inspection also confirms Clipper's guest `accountFor` path calls
`guestAudience`, which verifies the token's signature against the app/endpoint
before registry resolution; it neither creates an account nor trusts decoded
claims alone. Explicit extension origins retain their bounded ID/origin checks.

Root installation succeeded. With the combined patch, Local First's 1,090 unit,
20 native and 72 restore tests passed (7 existing opt-in measurements skipped).
Application-specific worker/auth/offline qualification remains required as each
app is imported; this record does not claim app handoff or production acceptance.
Original app patches remain available in source history and imported provenance.

The alternate GitHub connector could read Finance issue #61, requiring retention
of the alpha.59 historical archive and compatibility fixtures. The direct PR
inventory and CLI fallback are blocked by the configured token lifetime policy;
no authentication setting was changed. Open PR disposition must be completed
before source handoff. Only explicit default-branch commits are imported.

Rollback restores the previous root SDK patch configuration/lockfile. Existing
source repositories, deployments and user data are untouched.
