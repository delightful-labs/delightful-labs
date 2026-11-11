# Ordered sign-out workflow

Consumer authorization: Clipper workflow-hardening change set D. This is a generic
provider-injected identity composition; Clipper retains HTTP/cookie policy and UI
feedback. No backend, provider, account-selection or domain policy is introduced.

Input supplies an optional provider operation, native logout, stage deadlines,
optional synchronous native identity observation and bounded overdue reporting.
The chart selects provider sign-out first when supplied, then observes native
facts before mutation. Already signed-out completes without another logout;
replacement/unavailable facts refuse mutation. Native logout requires the original
identity, with atomic admission also enforced by its injected capability.

Each effect stage owns one original invocation through waiting and overdue.
Failure completes with typed stage facts; no raw exception crosses the public
result. Success requires confirmed provider completion when supplied, followed by
either observed native sign-out or acknowledged native logout. The consumer
refreshes native identity after settlement before admitting a later attempt.
Shutdown never replays or interrupts issued calls.

The parent retains this child until settlement, including during shutdown. Forced
actor disposal is disruptive and cannot be interpreted as successful sign-out or
native quiescence. The existing acquisition/session owner retains SDK custody.

Qualification covers optional provider, ordered success, each stage rejection and
expiry, late completion after expiry, repeated shutdown, forced stop, independent
generated schedules and the actual Clipper application/Worker shutdown composition.
Use the existing public package-consumer fixture and compatible alpha.60 archive
qualification gates before changing a consumer pin.

Qualification at source `5bb6605`: 191 selected sign-out/session/lifecycle/
transaction tests in 11 files; strict sign-out test types; zero-error/warning
library checks; strict package publint; all public consumer declarations, fixtures
and builds. The independent sign-out receipt campaign runs 120 schedules, at most
12 commands, seed `20261117`, with complete contract-model coverage. Clipper's
compatible alpha.60 archive and native/browser/offline evidence are recorded in
its companion PR #33 and `docs/reviews/auth-request-lifecycle.md`.
