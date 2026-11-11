# Design Review and Future Validation Guide

**Status**: Historical broad acceptance proposal. Its plugin/schema scaffolding is deferred and must not be treated as an implemented quickstart. Use `package.json`, the capability-specific recovery/startup/readiness/workspace plans, and the [current contract map](contracts/foundation.md) for delivered entry points and validation commands.

## Available Now

Use the repository's Node/pnpm requirements and install only the existing tooling:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
```

These commands validate tooling/documents, not foundation behavior. The lint command currently
permits no source files. For a focused documentation change, check only the relevant paths with
`pnpm exec oxfmt --check <paths>`. Do not format inherited tooling or unrelated files.

Review [spec.md](spec.md), [data-model.md](data-model.md), and
[contracts/foundation.md](contracts/foundation.md) together. The
[capability evidence](qualification.md) records source findings, not runtime passes.

## Future Prerequisites

Before executable validation, obtain a new implementation instruction, implement a focused task,
and present that exact implementation for approval before adding/running its implementation tests.
Pin native SDK/server versions, contract version, browser/storage configuration, and any required
schema/permission deployment. Finalize scripts/ports when the demonstration is designed; no
nonexistent `dev`, conformance, or test commands are prescribed here.

The eventual consumer fixture uses generic app-owned collections and protected grant records,
not Finance/Clipper models. Run the identical portable declarations and data access against each
backend in separate instances, ports, and browser storage. Two separate apps using each backend
exercise identity reuse; unrelated identities exercise permissions. Neither a fake nor an
ineligible DXOS deployment substitutes for the second qualified real backend.

## Acceptance Scenarios

| Scenario                                                   | Expected result                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Incompatible contract or missing baseline capability       | Actionable preflight failure before dependent operations                                        |
| Create/resume/recover/connect identity, second-device flow | Explicit native outcomes, no duplicate identity on retry, authority disclosure before reuse     |
| Cancel/interrupt identity interaction                      | Transient credentials cleared; no false completion or claim to revoke already-granted authority |

| Unrelated identity accesses a private workspace | Denied at the applicable storage boundary; record enforcement point/timing, including offline cases |
| Repeated invitation acceptance | Existing membership or explicit terminal outcome, no duplicate grant |
| Same schema/CRUD/query on both backends | Identical portable consumer declarations/code; null/range/AND/sort/limit semantics match draft contract |
| Bounded query receives insert/update/delete, null values, tied sort values | Correct ordered bounded snapshots with deterministic IDs as tie-breakers |
| Empty local query while offline | Empty with local/unknown coverage; no unsupported global completeness claim |
| Locally durable write, process restart offline | Acknowledged change available; persistence failure never reported durable |
| Later remote rejection after local acknowledgement or restart | Active runtime delivers rejection; restart reconciliation uses native evidence or reports unknown, never assumed acceptance |
| Scope switch/dispose during pending work | Obsolete observers stop and sensitive old-scope presentation data clears |
| Optional local-atomic transaction, injected failure/restart | All-or-none persisted group; absent capability prevents all group writes |
| Optional authority transaction, concurrent conflict/offline authority | Correct accept/reject/pending outcome, never false authority acceptance |
| Keyboard/dialog dismissal/localized status | Semantic controls, appropriate focus return, no duplicate announcements, no hardcoded messages |

Additional contract-review scenarios:

- An unrelated identity cannot access another identity's private workspace. Workspace member
  access levels follow the selected backend's documented model. No cross-app data-sharing flow is
  required for v1 qualification.
- Patching record ID/workspace, explicit undefined, and unknown fields fails validation; an old
  workspace handle fails with scope.stale instead of following the newly selected workspace.
- Close preserves the documented session selection; logout invalidates the selected session;
  cancelling a pending form does neither. A persistence failure during close remains visible
  and retryable, without silently declaring that the runtime closed safely.
- Missing settlement history after restart yields unknown and no automatic mutation retry.

Fault injection and direct native-access checks are future conformance design, not tests added in
this phase. Document what each scenario proves and its limits, including previously disclosed
data, offline revocation, native conflict resolution, and subscription visibility.

## Reporting and Release Gates

Reports must distinguish contract compatibility, source evidence, baseline compliance, app
qualification, and optional capability results. Include versions, execution environment, failures,
unsupported guarantees, and evidence for any durable/accepted outcome. A fake is useful for
routine deterministic checks but never establishes cross-backend parity.

Current result: source investigation only; neither backend is fully qualified and the draft
contract is not stabilized. Review the design before task generation. Final acceptance still
requires Jazz plus a second real backend passing all mandatory foundation scenarios; additional
consumer-specific scenarios require explicit product approval.
