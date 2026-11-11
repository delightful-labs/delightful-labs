# Incremental identity-restoration adoption

Status: implementation committed as `1e63e89`; focused verification changes prepared for review.
Branch: `feat/identity-restoration-main`, created from main `629bd82` after PR #35 merged.
This follow-up can target main directly; it no longer needs a stacked PR base.
Library branch: `feat/identity-restoration-plan`, runtime committed as `9549312`.
The archive was packed from that reviewed runtime before the commit; subsequent library changes
add coverage and documentation only.

Finance consumes `vendor/delightful-local-first-0.0.0-restoration.tgz`, SHA-256
`6a7f3aef5dcc2fa2f656c0d3d49f22fcb3ff7f9154e6109c44989b3d7c692f05`.
The superseded recovery archive is removed. The current DUI archive is retained.

## Implemented ownership

`src/lib/machines/identity/session-recovery.ts` currently owns validation, preparation acknowledgement,
the issued Jazz restoration, identity reading, and navigation. Its application parent outlives the
login route, drains workspace resources, and reattaches after mutation settlement. Preserve those
lifetimes. A component-owned promise would lose an issued operation when navigation unmounts it.

Validation and restoration now run in an invoked library child. The existing Finance wrapper
keeps navigation and protocol translation; application readiness remains the workspace drain owner.
LoginForm, the login route, startup, schemas, and catalogs are unchanged.

```text
application readiness
└─ existing session-recovery wrapper
   ├─ invoked library restoration child
   └─ existing navigation/check/retry states
```

The library child reports validation and preparation request using attempt + session binding.
The wrapper forwards the existing `RECOVERY_VALIDATED` / `RECOVERY_DRAIN_REQUESTED` notices;
application readiness still owns draft reset and actual resource cleanup. The wrapper forwards a
matching `WORKSPACE_DRAINED` acknowledgement as the child's preparation permit. Reject stale
correlation and duplicates. No parent reads child context to infer progress.

The layout supplies a synchronous binding factory to application readiness. The factory creates
the adapter for its existing session using `getCurrentJazzSession` as the live accessor, only for
restore requests. Navigation-only retries acquire no adapter. The wrapper supplies that fixed
capability through actor input to the library `restorationMachine`, since the session becomes
available after machine definition. It clears its own phrase request after child input is bound,
and invalidates/releases the adapter when the restoration compound state exits. No SDK parsing,
credential context, session mutation, or identity-read actor remains in the Finance wrapper.

Once the SDK restoration is issued, cancellation/shutdown retains the invocation until settlement.
The child clears its phrase/credential references and returns sanitized output without secrets.
The wrapper checks the current identity, readiness, and origin URL before navigation. Navigation-only
retry preserves the existing guarantee that it cannot repeat the identity mutation. The application
keeps observer/startup-failure priority and reattaches from actual session facts, including same-client
failure. A rejection does not imply rollback, unchanged identity, or permission to automatically retry.

## Recursive machine-first audit

The library owns assessing → validating → awaitingPreparation → restoring/settlingCancellation →
readingIdentity and its finite outcomes. The wrapper's validating/awaitingDrain/operating states own
only the host handshake; it forwards matching binding/attempt reports and one preparation permit.
Its closing state keeps the same library invocation until terminal output. Wrapper navigation facts
are one related synchronous snapshot/URL projection; navigation is one existing leaf call.
`identityUnavailable` maps to Finance's existing navigation-failure result without a retry identity,
not a claimed usable identity. A rejected restore maps to restoreFailed; cancellation maps to closed.
Unexpected child crashes propagate as a sanitized application failure rather than a fabricated
settled result. Stopping/crashing an owner cannot guarantee settlement of an SDK call already issued.

No hidden async preparation, promise bridge, registry, second client, or duplicate restoration owner
is introduced. Report correlation is checked in the wrapper; application readiness retains its
existing attempt correlation and workspace/observer/startup/shutdown priority.

## Static verification

`pnpm check` reports zero errors/warnings. Frozen-lockfile install, focused formatting, and diff
checks pass. Installed module resolution confirms shared physical Jazz, DUI, Svelte, and XState
instances. Library package validation passes. These checks do not establish runtime correctness.
The expanded library suite passes 81 tests: 34 lifecycle scenarios against each capability API,
plus 13 Jazz adapter scenarios. The public-package fixture now exercises the invocation-input entry.
Finance passes 34 focused recovery/session-mutation unit tests; 16 unrelated cases in that file
were intentionally skipped. Types and public package-consumer checks also pass.

## Approved verification

The reviewed implementation is covered by updated fixtures that supply the layout-style binding
factory. Assertions verify real protocol reports, stale binding/attempt rejection, drain ordering,
private request cleanup, retained issued calls, adapter invalidation, same-client failure handling,
partial identity observation, and navigation retry without rebinding/restoring. Credential comparisons
return booleans rather than exposing generated phrases or roots in failed assertions.

Ten focused protected Chromium scenarios pass on the disposable agent server at
`http://127.0.0.1:5184`: three invalid phrase cases; restoration into another browser context;
reveal/dismissal followed by profile saving; SDK/session failure recovery; selected-identity storage
failure/retry; recoverable same-client failure/remount; navigation-only retry; and multiple-workspace
chooser behavior. Screenshots, video, traces, and automatic failure-page snapshots are disabled.
The four empty-draft assertions use a shared boolean-only helper, preserving credential protection
if cleanup regresses. Unrelated image, startup, and domain suites were not rerun.

The first browser attempt encountered a startup collision before any scenarios ran. The known agent
server was restarted, verified with an HTTP 200 response, and reused for the actual scenarios.
There were no production fixes after implementation review. These checks qualify this packed
snapshot against Finance's existing real session; they do not qualify all SDK versions or a full
foundation session/workspace migration.

Affected unit coverage is the application-owned account recovery block in
`src/lib/machines/runtime/application-readiness.test.ts`: invalid draft, matching drain, stale
notices, duplicate requests, interruption, retained issued restore, same-client failure, and
navigation-only retry. Existing fixtures inspect old child context; replace those with observable
protocol/cleanup assertions where the extraction makes the context private.

Affected browser coverage is `tests/authentication.e2e.ts`: invalid inputs preserve identity/data,
restoration across contexts, restore failure/session retry, navigation failure/retry, route departure,
and empty restored-workspace behavior. Keep its credential artifact protections. Reuse only a known
disposable agent server and finish generated-environment checks before browser work. The updated coverage and these verification notes remain uncommitted for review.
