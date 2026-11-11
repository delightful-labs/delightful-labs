# Extension sign-in completion repair

The user authorized implementation and regression tests by continuing the proposed
repair on 2026-11-11. This slice preserves account admission, approved copy,
storage keys, package versions, native shutdown and existing test deadlines.

## Diagnosis and ownership

The unmodified three-case run reproduces all three failures. In the first case,
restoration completes, connection confirmation persists, and the sign-in chart
reaches connected. The host then drains application/session/store/broker owners
and reaches closed. Popup closure is nevertheless lost: the worker posts CLOSE
on the account MessagePort and CLOSED on the primary worker channel. Processing
CLOSED disposes the account port; the other channel's CLOSE need not run first.
A rejected optional offscreen notification appears in the trace but is already
handled by the confirmation chart and does not prevent durable confirmation.

The stale-account case passes independently with a fresh test authority. Subsequent
failures in the original sequence stop while restoring after Playwright replaces
the failed test worker/authority. They are not yet evidence of separate product
bugs; repeat the original sequence after repairing the first failure.

The existing state owners remain unchanged: restoration -> durable confirmation
-> connected -> host shutdown -> application drain -> native session close ->
account-store close -> broker close -> CLOSED. The shared UI client owns worker
and port disposal only after CLOSED. Sign-in supplies a native window-close
callback at that disposal boundary. Settings supplies none. Remove the redundant
cross-channel CLOSE protocol; no domain decision moves into the Window.

Regression checks must exercise the real shared client/account adapter, prove
failure or requested shutdown alone cannot close the popup, and prove CLOSED
releases native resources before closing it. Packaged Chromium tests must retain
invalid-input refusal, original-gesture continuation, stale-account rejection,
24 settings teardown cycles, zero UI-thread WASM and offline/restart behavior.

## Verification

Node 24.22.2 / pnpm 10.28.0, macOS arm64, the existing bundled Chromium. No
packages, browser versions, SDK patches, catalogs or account data formats changed.
Isolated test servers used 127.0.0.1 ports 5250/5251/5252; all browser profiles and
authority stores were disposable. Original source checkouts and user servers/data
were untouched.

| Check | Result |
| --- | --- |
| Original unmodified three-case sequence | Same three failures reproduced |
| Original stale-account case in isolation | Passed |
| Focused account-client/sign-in/confirmation tests | 12 passed |
| Full Clipper unit/native suite | 909 tests passed in 133 files |
| Root tooling, web and extension type checks | Passed; zero Svelte errors/warnings |
| Repaired original three-case sequence | 3 passed, including 24 settings cycles |
| Complete packaged extension suite | 12 passed, zero skipped, 41.3 seconds |
| Clipper format/lint and shared guidance links/discovery | Passed |

Three new tests exercise the actual account adapter and shared UI client. They
cover explicit and worker-initiated shutdown, native cleanup before the close
callback, and refusal to release/close after a worker error without CLOSED.
The first confined full-suite attempt stopped after native fixture setup failures;
the full native suite passed with the required local runtime/network permissions.

The packaged suite retains its assertions and deadlines. It verifies invalid
phrase rejection, explicit confirmation, the original gesture's continuation,
account separation and switching, no private capture from source messages,
full offline browser restart/reconciliation, and all 24 abrupt settings teardown
cycles with zero Window WASM. Only the temporary three Linux skip gates are
removed. Hosted Linux must exercise these cases before release acceptance; local
macOS success is not Linux qualification. Nonfatal existing fixture backend 401
messages remain in the browser logs and are not represented as repaired here.

The missing optional offscreen notification receiver is a handled outcome, not
the cause of lost popup closure. Confirmation, writes and teardown are never
retried by this repair. The independently reproduced native Jazz/V8 abrupt-Window
teardown issue remains a separate SDK/browser investigation, not a fix claimed
from this acknowledgement-order correction.

No deployment, push, merge, upstream report or repository-setting change occurred.
Rollback is a revert of this repair commit. Shared guidance/CI remains independent;
upstream/open-work reconciliation and hosted previews/CI precede source handoff.
