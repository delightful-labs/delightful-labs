# Incremental local-first recovery adoption

Finance consumes a packed Delightful Local First snapshot from commit `42d001c` through
`vendor/delightful-local-first-0.0.0-recovery.tgz` (SHA-256
`fdfb044552aa5304e90560add5a8f6039185a30ec72b5d43171e5c5eaa847244`).
It is a private integration snapshot, not a published release or live source link.

Only `RecoveryPhraseIntegration.svelte` changes its runtime ownership. Finance still owns the
existing Jazz session/provider, account route, profiles, login, restoration, and workspaces.
The library owns the recovery state machine and presentation, including the single Close button
below the phrase. There is no saved-phrase checkbox. Finance's root DUI theme remains in use.

## Binding and cleanup

The integration obtains the existing session from context and creates one adapter and source.
The library subscribes on mount; the source forwards the session store's immediate snapshot and
later observations. Only a ready session publishes an account. Transitioning, failed, signed-out,
and closed sessions publish unavailable, invalidating recovery before a replacement is ready.
The adapter's live getter repeats that readiness boundary at export and result acceptance.
Observed replacement advances the adapter generation, including switching away and back.

The existing library statechart owns hidden, revealing, revealed, failure, unavailable, and shutdown
behavior. This host adds no async workflow or actor. It only binds observations and cleanup.
On teardown the library shuts down its actor before releasing this subscription; the source then
invalidates its adapter in a finally block. It never logs out, closes the session, starts a second
client, queries records, or changes persisted data. No secret-bearing actor inspector is attached.

English messages come from the library using Finance's explicit locale. Both projects currently
support only English. Finance's own Paraglide runtime remains responsible for route/domain copy.
The old Finance recovery view, machine, contract, unit tests, and catalog keys are removed.
Restoration and login remain Finance-owned.

## Review and verification

The frozen-lockfile install, `pnpm check` (zero errors/warnings), focused Prettier check, and
`git diff --check` pass. Node resolution inspection confirms that host and installed library resolve
the same physical Jazz, DUI, Svelte, and XState modules. These checks do not establish successful
export through Finance's actual session or browser cleanup by themselves. The focused browser
checks below exercise the packed library through Finance's real host session.

The approved authentication coverage now checks Close/Escape/backdrop dismissal, phrase removal,
focus return, absence of acknowledgement UI, and a persisted profile-name save after dismissal.
Additional host scenarios cover route unmount/remount and replacement of the current account.
Existing cross-device restoration coverage exercises the phrase exported through the packed adapter.
Every phrase-export caller in the authentication suite uses the retained public label and Close action.
Library workflow coverage replaces tests of the deleted Finance machine.

The authentication file disables traces, screenshots, and video, including in CI. It also sets
`PLAYWRIGHT_NO_COPY_PROMPT=1`, which the installed Playwright 1.64 honors when collecting failure-page
ARIA snapshots. Assertions on generated phrases return only booleans; generated credentials are never
included in assertion messages. Browser checks use isolated contexts and the disposable agent server.

Reverting this dependency and integration change restores the prior mount without data conversion.
Public library interfaces remain provisional until packed host compatibility is exercised.

## Adoption verification results

Five focused Chromium scenarios pass across the final targeted runs on the disposable agent server
at `http://127.0.0.1:5184`:

- Close, Escape, and backdrop clear the phrase and restore focus; profile editing still saves and
  survives reload with the same identity afterward.
- Route navigation while revealed removes the phrase; returning starts hidden and permits a fresh
  reveal on the same host identity.
- Replacing the account through the existing session invalidates the old phrase and permits a new
  reveal after readiness returns.
- The exported phrase restores the original workspace data into another browser context without
  duplicate or previous-identity accounts.
- The existing profile trim/reload/clear scenario continues to pass.

`pnpm check`, `pnpm check:tests`, focused Prettier checks, and `git diff --check` pass. Initial test
fixture corrections added an explicit session-readiness wait and used the existing navigation helper
for the collapsed sidebar. Production code did not need changes after review. No redundant Finance
workflow unit suite was added: the retired machine and its tests are deleted, and the library retains
its workflow, adapter, SSR, and synthetic browser coverage. Other authentication and domain suites
were not rerun. This qualifies the reviewed snapshot in this local host graph, not every SDK version,
browser, release package, or full MVP capability.
