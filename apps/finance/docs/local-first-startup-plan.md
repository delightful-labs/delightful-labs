# Shared session startup: Finance adoption

Status: reviewed implementation and focused verification complete.
Finance branch: `feat/shared-session-startup`, from main `4905793`.
Library branch: `feat/session-startup-acquisition`, containing implementation `a4518fb` and reviewed
coverage/observer-cleanup commit `4e60408`. Earlier recovery/restoration PRs are merged; this work
uses fresh branches and does not modify closed PR heads.

Snapshot: `vendor/delightful-local-first-0.0.0-session.tgz`, SHA-256
`bd329b99c12ae5573739182aaf77e1693b6799460978816acef16af5228b4c59`.
The superseded restoration archive is removed; DUI's current archive is retained.

## Preserve the two lifetimes

Finance's layout/application owns workspace, bank, transfer, and recovery cleanup. Its browser
runtime currently retains the SDK session and pending startup promise across layout lifetimes.
Replace that cached-promise orchestration with one explicit library acquisition owner retained by
the browser host. An application-owned startup attachment communicates with it through typed
request/reply/release events. The owner outlives application detach; it retains an issued SDK open
and its eventual session even if no layout is listening. Joining/remounting must not open a second
session or close the shared one.

```text
Browser host runtime → retained library acquisition owner → one SDK createJazzSession invocation
Finance application → startup attachment → typed direct requests to that owner
                    → existing workspace, session observer, and restoration subtree
```

There is no new session provider, generic global registry, or parent polling of private child
context. Keep the existing JazzSessionProvider and SDK session observer. Session acquisition means
obtaining the configured session reference; it does not mean signed in, workspace ready, or remotely
fresh. Keep session.retry after an acquired-session failure separate from initial acquisition retry.

## Implemented host seam

- `runtime/jazz-session.ts` retains one browser acquisition actor and fixed configuration metadata.
  `getJazzStartupBinding` creates/reuses that owner and allocates a fresh attachment token, without
  issuing SDK creation itself. It rejects SSR use and changed configuration instead of creating a
  competing owner. Pending/session selection and retry live in the library statechart; there is no
  second session/promise cache. `getCurrentJazzSession` uses the public resource selector, preserving
  the accessor used by restoration, profile/domain integration, and existing browser fixtures.
- The layout sends START with this binding only from onMount. It keeps JazzSessionProvider and all
  domain/presentation composition. There is no server-side SDK acquisition.
- Application readiness invokes the library startup attachment with a typed report recipient.
  waitingForStartup → opening → running uses exact binding/token/generation correlation. Its
  explicit acquisition retry advances expected generation before sending RETRY. Repeated START
  cannot replace the current binding. Late acquired reports cannot restart a closing application.
- Acquired-session SDK status observation and session.retry remain unchanged. Public startup-owner
  failure follows the existing startup-failure drain policy, including retained issued retry and
  restoration calls; it does not bypass their closing states.
- Shutdown drains workspace/transfer/restoration work first, then enters releasingStartup. It sends
  SHUTDOWN to a live attachment or completes immediately for an already failed/completed child,
  and only then reaches closed and clears local session/binding references. No SDK close/logout or
  shared-owner stop is added. Crashed attachment requests are retired through best-effort RELEASE;
  retry uses a fresh attachment on the same owner, never an automatic replacement owner.

## Recursive machine-first audit

The host runtime's synchronous factory performs only browser/config identity checks and allocation
of one retained actor reference; it neither invokes nor caches a promise. The library statechart
owns SDK creation, deduplication, failure, retry, and publication. The parent models initial binding,
acquisition failure/retry, domain draining, release acknowledgement, and closed explicitly. No new
promise actor, async helper, actor-start-and-await bridge, registry, or mirrored pending flag is
introduced. Low-level child lifecycle checks prevent waiting for failed actors; parents do not read
library state paths/context to infer readiness. Existing session retry and navigation actors remain
individual SDK/router leaf calls under their existing parent states.

The shared owner remembers acquisition failure. Remount attaches to that failure rather than
silently retrying; the existing explicit Retry action starts the next acquisition attempt. This is
an intentional failure-policy clarification for review, not an automatic retry timer or new copy.
Duplicate starts/retries while opening share the current issued call.

The public backend leaf calls Jazz createJazzSession with the existing app/server/storage and
explicit initial policy. It must not introduce remote preflights, workspace bootstrap, starter data,
seeding, provider sync, or a replacement identity based on missing local rows. Final session disposal
and configuration replacement remain outside this first slice; stopping the owner is not SDK cleanup.

## Verification

Implementation review was approved before test changes and execution. The reviewed library has
31 passing focused tests plus type, lint, formatting, package, publint, and public-consumer checks.
The packed snapshot contains that committed runtime.

Finance's migrated readiness and host-runtime suites pass all 62 tests. Coverage retains existing
restoration/session-mutation cases and verifies duplicate starts, acquisition failure/retry,
pending acquisition across release/remount, stale reports, owner failure during issued operations,
and workspace draining before release acknowledgement. The inactive Finance startup machine and
its superseded tests are removed.

The production-preview cold-start harness passes both cases: a remote connection that opens but
never answers, and fully offline startup. Each closes every app client, restarts the browser with
its existing local profile, then verifies reads, saves, and reloads. These checks qualify local
availability; they do not claim remote acceptance or final session disposal.

The authentication fixture discovers the existing SDK instance through the layout integration
instead of the former direct import in the host runtime. Credential screenshots, traces, and videos
remain disabled for these scenarios. All 11 focused authentication scenarios pass: invalid phrases, existing workspace restoration,
modal dismissal, startup retry, restore/session retry failures, same-client remount recovery,
navigation-only retry, and workspace selection.

Normal full-source checks report zero errors/warnings; browser-test types, focused Prettier, and
diff checks pass. Frozen-lockfile installation and installed-module checks confirm shared Jazz,
DUI, Svelte, and XState instances. No catalogs, schemas, or financial behavior changed. The user environment at 5173/5174 remains
untouched; browser verification uses disposable agent environments only.
