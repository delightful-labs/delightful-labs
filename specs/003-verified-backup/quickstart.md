# Validation and recovery rehearsal guide

**Current status**: documentation only. No executable backup command or UI exists yet. This guide defines the future validation procedure rather than presenting nonexistent commands as runnable. Implementation PRs must replace the described entry points with actual commands and routes before feature completion.

## Prerequisites

- Review the implementation slice before adding/running its implementation tests, following repository policy.
- Use disposable sessions, browser profiles, and Jazz apps for integration checks. Never clear the user’s storage or run an automatically publishing server against production.
- Have a recognized profile, an independently readable archive, and—for restore—a qualified destination adapter with enforced incomplete isolation.
- Complete [Finance deployment and coverage checks](contracts/finance-adoption.md) before touching real data.

## Archive and independent inspector

1. After implementation review, create a small nonfinancial profile with exact integers, dates, relationships, archived records, and known attachment bytes.
2. Produce both plaintext and password-protected files using the actual public DLF archive exports.
3. Close the exporting app. Open the retained file in the independent inspector with no original session/network access. Decrypt when necessary and verify generic integrity plus recognized-profile validation.
4. Alter bytes/header parameters, use the wrong password, duplicate a JSON key, exceed each input bound, break a reference, and remove required attachment bytes. All cases must reject without any destination writes.
5. Confirm plaintext integrity is not presented as publisher authenticity; unsupported profiles remain distinct from invalid files and domain-validated files.

## Shared workflow and Jazz boundary

After the corresponding implementation is reviewed, exercise cancellation during resource acquisition/crypto/commit, A → B → A identity/workspace changes, access loss, child failure, and delayed reports. Verify release/drain and absence of secrets in logs or serialized machine state. Reopen an interrupted operation with the same retained file/password and verify journal digest binding.

With the pinned real SDK on a disposable app, create pending local changes and compare remote/local-first behavior. Confirm incomplete capture is reported rather than dropping those changes. Exercise missing file parts, changing source data, owner/admin/selected-account permissions, failed reads, and unsupported legacy references. Two equal graph reads without the quiescence precondition must not be documented as a snapshot guarantee.

## Finance destination

1. Verify invalid archive cases issue zero destination writes.
2. Restore a complete fixture graph into a fresh workspace with no seeded categories, no previous grants, and no active bank links. Confirm original workspace values and membership unchanged.
3. Interrupt before commit, after accepted commit but before receipt, during comparison, and after activation but before acknowledgment. Reopen with the same archive; retries preserve mappings and produce no duplicate records.
4. Attempt direct-route navigation, editing, imports, invitations, and cached-client operations against incomplete destinations. Check actual backend permission behavior and application exclusion, not just hidden selectors.
5. Verify all records/relationships and original attachment bytes after a fresh session/restart. Counts alone do not pass.

## Actual deployed backup

Only after the integration checks pass: establish the explicit maintenance window, inspect deployment compatibility read-only, export the real workspace, retain/reopen the file, and demonstrate full verified recovery into a separate destination. Record revision/profile, aggregate coverage, byte/digest comparisons, and outcomes without exposing records/passwords. Preserve original workspace and backup file. This result precedes identity/storage changes.

## Repository documentation checks

These are available now and do not test implementation:

```sh
pnpm format:check
```

The existing lint/type/package/test scripts become relevant to changed implementation slices later. Do not run the all-in-one `verify` before implementation approval because it includes tests. A specification formatting pass is not evidence of backup safety.
