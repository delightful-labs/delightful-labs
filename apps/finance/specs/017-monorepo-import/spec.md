# Finance workspace import

Follow the root migration spec at `../../../../specs/002-monorepo-agent-guidance/spec.md`.
Import Finance main `230bc7cc38db3745d75b3c6fd40c861855fa0cf1` with history,
preserve its scoped constitution and product policies, and qualify root installs,
workspace UI consumption, shared SDK patches, checks, tests and preview builds.
The worker-recovery Local First source differences are reconciled; use its
qualified workspace source while retaining historical fixture/archive provenance.
Keep legacy archives and backup fixtures associated with source issue #61.
No production data, localization, application workflows or hosted settings change.

The user explicitly authorized continued migration implementation including tests
on 2026-11-10; that session authorization covers these migration batches. Future
application work retains Finance's normal implementation review gates.

See the root Finance import record for results and remaining handoff work.

The [draft PR #67 salvage review](../../../../specs/002-monorepo-agent-guidance/finance-worker-pr67-review.md)
records the worker branch's build and feature-parity blockers, material worth
preserving, and a suggested incremental path if that separate migration resumes.
Import completion does not require rescuing the entire draft. The review is a
recommendation, not an approved implementation or production cutover plan.
