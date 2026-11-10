# Ordered sign-out workflow

Consumer authorization: Clipper workflow-hardening change set D. This is a generic
provider-injected identity composition; Clipper retains HTTP/cookie policy and UI
feedback. No backend, provider, account-selection or domain policy is introduced.

Input supplies an optional provider operation, the native session logout operation,
stage deadlines, optional synchronous native identity observation and bounded overdue reporting. States select the provider stage
when supplied, then observes native facts before mutation. An already signed-out native identity completes without another logout; replacement/unavailable facts refuse mutation. The session stage requires the original identity, and its capability must enforce atomic admission too. Each stage owns
one original invocation through waiting and overdue. Failure completes with typed
stage facts; no raw exception crosses the public result. Success means both calls
settled successfully, with the consumer responsible for observing native identity
before admitting a later attempt. Shutdown never replays or interrupts issued calls.

The parent retains this child until settlement, including during shutdown. Forced
actor disposal is disruptive and cannot be interpreted as successful sign-out or
native quiescence. The existing acquisition/session owner retains SDK custody.

Qualification covers optional provider, ordered success, each stage rejection and
expiry, late completion after expiry, repeated shutdown, forced stop, independent
generated schedules and the actual Clipper application/Worker shutdown composition.
Use the existing public package-consumer fixture and compatible alpha.60 archive
qualification gates before changing a consumer pin.
