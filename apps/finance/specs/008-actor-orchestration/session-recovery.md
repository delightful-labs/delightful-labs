# Session recovery and workspace drain design

Status: reviewed six-file implementation verified after approval.
The preceding retry ownership slice is committed as `dca6b72` and remains verified.

## Decision

Coordinate the application's two existing SDK mutation entry points before invoking the SDK:
login restoration and session retry. Retain `JazzSessionProvider`, the shared-session adapter and
the SDK's public `JazzSession` API. Do not migrate providers or import its private consumer helper.

A completed workspace shutdown is the prerequisite for issuing either SDK mutation. This closes
the identified workspace/client ordering gap for application-initiated recovery: the provider's
later view-detachment acknowledgement cannot overtake cleanup that already finished. It does not
change SDK internals or claim control over mutations initiated outside the application protocol.

Production source inspection found only two mutation calls: login's `restoreLocalFirst` and
application readiness's `retry`. No logout, enrollment or JWT flows are currently exposed. Future
SDK mutation entry points must use this coordination boundary. Startup acquisition remains separate;
shared SDK sessions continue to survive layout remounts.

## Ownership and states

```text
application readiness
├── existing startup and session subscription
├── exact attached workspace → SHUTDOWN → actual closure
├── existing retry invocation, now gated on workspace closure
└── finite recovery child (survives login component destruction)
    validate phrase → request workspace drain → await acknowledgement
      → restore through SDK → navigate if still applicable → terminal result
```

Keep one recovery machine in `src/lib/machines/session-recovery.ts`. It owns validation, the
recovery secret while needed, restoration, conditional navigation and finite result classification.
The application owns its invocation across working and interruption substates, the workspace drain
handshake, attachment admission and replacement. No registry, generic supervisor, form framework
change or new controller layer is needed.

| Stage       | Responsibility / interruption                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Validate    | Pure phrase-to-secret leaf. Invalid input returns invalid without changing identity or draining the workspace.                                                                                                                 |
| Await drain | Request cleanup from the application with the current attempt identity. Await closure of the matching workspace. Shutdown here prevents SDK restoration.                                                                       |
| Restore     | Invoke one public `session.restoreLocalFirst(secret)`. Clear redundant phrase/secret context once handed off. Retain the issued call until settlement on shutdown or observer failure.                                         |
| Navigate    | After successful restoration only, invoke the root-bound navigation adapter with captured destination and origin. Skip navigation when the user already left that origin.                                                      |
| Finish      | Return invalid, restoreFailed, restored, navigationFailed or interrupted. Preserve that restoration succeeded when navigation fails; never retry restoration to retry navigation. Clear sensitive context on terminal cleanup. |

The root integration supplies navigation; no continuation reads a destroyed login page's runes or
captures its form element. SDK calls, navigation and phrase parsing are individual leaf effects.
Meaningful decisions and interruption gates belong to states/guards, including inside helpers.

An accepted attempt captures the exact SDK session, original attachment, destination and origin.
Duplicate recovery/retry commands cannot start concurrent SDK operations. Session observations keep
updating while an operation is live but cannot discard it. Shutdown outranks startup/observer failure;
late restoration success cannot initiate navigation after shutdown. A changed navigation origin
suppresses automatic navigation rather than undoing successful identity restoration. Issued browser
navigation cannot be promised reversible; await its result and classify it explicitly.

## Drain and attachment protocol

1. Validate before draining. For an eligible attempt, clear obsolete pending attachments, request
   shutdown from the matching live workspace, and block spawning replacement workspaces.
2. Release only the current workspace on its matching closure or crash notification. Do not wait
   for acknowledgement from a completed/failed dependent. Correlate drain acknowledgement with the
   current operation, so a stale closure cannot authorize another mutation.
3. Start the SDK call only once required workspace cleanup has completed. A workspace crash is a
   failure outcome, not proof of successful cleanup; fail the recovery attempt and use the existing
   application recovery path rather than authorizing identity mutation after an unknown drain.
4. While SDK mutation is pending, retain only the latest provider attachment, without spawning it.
   Exact detach identity can remove that pending attachment. SDK status alone does not establish
   operation completion.
5. On SDK settlement, refresh the workspace integration lifetime using an attachment revision in
   the root layout. This guarantees a fresh ATTACH even when SDK failure retains the same client.
   Do not retain/reuse an old attachment's closures after its integration was destroyed.
6. Admit the newly mounted attachment only after operation settlement and only outside failure/
   shutdown drain. Existing observer/startup recovery continues to own SDK error presentation.

The attachment revision is a generation for an actual integration lifetime, not a second lifecycle
flag. Key WorkspaceBootstrap by it. Advance it only after an issued SDK mutation settles and the old
workspace has drained. Invalid phrase input does not remount the page. Matching stale DETACH events
must not clear a fresh pending or active attachment. Keep the provider's own client key behavior.

Session retry also needs a pre-invocation drain stage; keeping its promise alive alone did not close
this ordering gap. Reuse the application's workspace cleanup protocol, while retaining the verified
retry interruption/settlement rules. Do not add another mutation manager or wrap SDK workflows in
local copies of account selection/client shutdown logic.

## Presentation and secret handling

Login remains the integration component for submission; LoginForm remains pure presentation. Replace
its local restoring/error flags with a small recovery view and callbacks. No visual redesign.
Invalid input preserves the entered phrase and existing validation feedback. A valid accepted
submission clears the form's phrase before asynchronous work can outlive the page. Parent/child
context must release redundant phrase/secret references at handoff and terminal cleanup; JavaScript
strings cannot be securely zeroed, and the SDK retains its own input for its operation lifetime.

Retain existing generic restore and SDK startup failure feedback. Add a localized navigation-failure
message explaining that the account was restored but the destination could not open. Offer navigation
retry separately; it must not request account restoration again. A successful identity switch followed
by navigation failure remains attached to the restored identity. Keep errors, phrases and secret values
out of public views, result payloads, URLs and logs. Navigation retry rechecks current origin/identity
rather than applying an obsolete redirect after another switch.

## Focused production scope for review

1. New `src/lib/machines/session-recovery.ts`: one finite recovery workflow and its typed result/view.
2. `src/lib/machines/application-readiness.ts`: recovery invocation, workspace drain handshake,
   mutation admission, retry pre-drain and attachment revision.
3. `src/routes/+layout.svelte`: bind root navigation and key WorkspaceBootstrap by attachment revision.
4. `src/routes/login/+page.svelte`: send recovery commands and consume the application-owned view;
   remove the procedural async restore/navigation handler.
5. `src/lib/components/LoginForm.svelte`: synchronous submission callback and explicit navigation
   failure/retry presentation alongside existing feedback. Keep UI structure and styling.
6. `messages/en.json`: localized restoration-succeeded/navigation-failed feedback.

These six files form one coherent integration change. No additional contract/helper files, provider
migration, shared form changes or workspace internals are planned. If implementation needs more,
revisit this scope before expanding it. Tests follow implementation review, not this design review.

## Verification after implementation approval

- Invalid phrase: no workspace drain or SDK call; preserve draft and identity/data.
- Hold real workspace-owned cleanup pending: neither restore nor retry may reach the SDK early.
- Workspace closure versus crash, stale closure, duplicate commands and attachment replacement.
- Shutdown before SDK issuance, while SDK call is pending, and before/while navigation is issued.
- Observer/startup failure retains issued SDK settlement without new work; shutdown priority holds.
- Successful restore/remount, recoverable failure retaining the old client, and SDK session recovery
  after account selection persistence failure; fresh attachment in every settled-client path.
- Navigation failure after successful restore and navigation-only retry, with no second restore.
- User navigation away during restoration must not receive an obsolete redirect.
- Existing identity/data retention, offline use, phrase clearing and sanitized diagnostics assertions.

The pre-drain guarantee covers the workspace subtree this application owns. Route-owned form actors
already have their own shutdown/settlement behavior; this design does not add a global barrier for
all former route actors. Verify the SDK's treatment of pending database writes separately before
claiming an application-wide write barrier. There is no promise of cancelling platform requests or
unloading the browser synchronously.

## Implementation review

The six production files above implement the agreed flow. The application invokes one finite
recovery child across validation, workspace draining, SDK work and interruption. Attempt-correlated
validation/drain notices clear the form revision and authorize SDK issuance only after matching
workspace closure. Workspace crashes enter recovery failure rather than authorizing a mutation.
Retry now has a separate `preparingRetry` state before its existing resource-retaining invocation.
Both operations reject duplicates and hold new attachments until settlement.

The child exposes parsing, drain acknowledgement, SDK restoration, identity observation, navigation
eligibility and navigation as separate states/effects. Restoration and navigation invocations remain
alive in their own closing substates. Shutdown before issuance starts no SDK call; shutdown after
issuance awaits that promise and suppresses subsequent navigation. Startup/observer failures follow
the application's existing drain paths, preserving shutdown priority. Terminal output distinguishes
invalid input, SDK failure, successful restoration, navigation failure and interruption; mutation
settlement is recorded separately from navigation outcome.

The root supplies route observation and navigation. The child compares current ready identity and
origin before navigation, including navigation-only retry. Navigation failure reports that restoration
succeeded; its retry never calls `restoreLocalFirst`. Parent/child context discards raw input and
secret copies at handoff/terminal cleanup. The child raises a cleanup event after binding the SDK
invocation input, clearing its redundant secret reference without discarding the issued call.
The SDK owns the remaining input for its operation lifetime; JavaScript strings are not zeroed.

After SDK settlement, the application advances an attachment revision and discards superseded
pending attachments; root layout keys WorkspaceBootstrap by that revision. A failed restore that
retains the old client therefore still gets a fresh workspace integration. Invalid input does not
drain or remount. LoginForm remains pure, uses existing controls/styles, preserves invalid drafts,
and provides localized navigation-failure feedback and navigation-only retry.

Recursive source review covered both changed/new machines and their callbacks. Promise actors
perform individual parsing, SDK, snapshot/route-read or navigation effects; business branches and
interruption/settlement decisions stay in states/guards. No private SDK hooks, manual actor/promise
bridges, new controller/helper/contract files, shared form changes or provider migration were added.
This remains a workspace-subtree drain guarantee, not an application-wide barrier for old route actors.

`pnpm check` passes with zero errors and warnings. Prettier and `git diff --check` pass. The approved retry fixtures
will need to acknowledge the new pre-SDK workspace drain before expecting a call. Implementation review was completed before the verification recorded below.

## Verification evidence after approval

The application/startup/shared-session unit run passes 51 tests across three files. The updated
application fixtures acknowledge workspace cleanup before expecting an SDK retry. Coverage includes
all session status observations, duplicate commands, stale closure/attempt notices, cancellation
before SDK issuance, pending restore/retry success and rejection under shutdown/observer/startup
failure, secret-reference release, fresh same-client attachment, navigation-only retry, changed
identity/origin checks and waiting for issued navigation on shutdown. A separate workspace
coordinator/startup/navigation regression run passes 51 tests across three files.

`pnpm check` passes with zero errors and warnings; `pnpm check:tests` passes. Browser fixtures now use
explicit workspace query scope, count workspace records independently of the placeholder option,
and wait for session readiness before injecting navigation failure. Nine browser checks pass across focused runs: three invalid-phrase scenarios, existing workspace/data
restoration across identities/devices, repeated startup/network retry, SDK teardown failure recovery,
selected-identity persistence recovery, recoverable same-client restoration, and navigation-only retry.
The navigation fault is injected before router state/history commit; SDK public observations confirm
exactly one restoration despite the navigation retry. The test checks the overview path and restored
workspace separately rather than rejecting its legitimate query parameter. Existing identity/data,
category uniqueness, phrase clearing and sanitized SDK-error assertions remain covered.

No production fixes were needed during verification. Prettier and `git diff --check` pass. These are
focused results, not a full application/PWA rerun. Application tests gate an explicit workspace cleanup
acknowledgement; existing workspace regression tests cover descendant drain behavior. No claim is
made that this adds a global barrier for unrelated former route actors or controls external SDK calls.

## Sign-in workspace selection correction

Sign-in must not carry the previous identity's selected workspace into the restored
identity's destination. Redirect successful login to the unscoped root. The existing
workspace navigation machine waits for readiness and the organization query, selects
an available workspace automatically when exactly one exists, and opens workspace
management when there are zero or multiple choices. Explicit unavailable workspace
links outside login retain their existing unavailable outcome.

This is a synchronous destination correction in the login integration, not a new
workflow. Recovery still owns validation → workspace drain → SDK restoration → identity
read → guarded navigation; issued restoration/navigation settlement, shutdown priority,
stale-origin checks and navigation-only retry remain unchanged. No actors or helpers
add hidden orchestration, and no new resource is acquired.

- [x] Remove the old identity's workspace from the login destination.
- [x] User implementation review.
- [x] After approval, inspect application-readiness/workspace-navigation unit tests and
      login recovery browser scenarios; verify old workspace → different restored
      workspace, multiple-workspace chooser, failed restore and navigation-only retry.

### Workspace correction approved verification

The session's implementation was approved for testing. All 52 focused browser checks
pass, including restoration from a different identity's scoped login URL directly to
`/?workspace=<restored-id>` before any manual navigation. Multiple workspaces open the
unscoped chooser. Invalid phrases, startup/recovery failures, identity retention and
navigation-only retry regressions pass. The 125 focused unit checks include application
readiness and workspace navigation. No production fixes were needed; type/fixture,
formatting and whitespace checks pass. Browser tests used disposable in-memory Jazz.
