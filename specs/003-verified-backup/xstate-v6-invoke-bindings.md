# Invocation binding qualification

Finance's full connected-graph migration exposed a readiness-generation mismatch
in the packaged form owner. The user authorized completing implementation and
tests together, including fixes needed in shared dependencies.

On the installed, unpatched `xstate@6.0.0-beta.1`, an invocation input mapper
sees the owning state's context before that state's entry patch. A minimal native
machine with context `{ generation: 0 }`, an entry patch incrementing generation,
and an invocation receiving that generation produces parent generation 1 and child
generation 0. The form consequently rejects its own watcher's reports.

The first watcher now starts with generation 1 already in initial context.
Retry advances generation in the incoming transition to `watching`, before its
invocation is bound. Failure still clears capability, and stale generations remain
rejected. No new actor, intermediate routing state, engine patch or public protocol
is needed. Initial readiness, failure, retry and stale-report rejection require
qualification through the actual composed form owner, in addition to leaf tests.

Audit other entry patches feeding same-state invocations before treating the
remaining converted graphs as qualified. Finance's independent worker handoff and
native crash/storage qualification remain separate work.

The workspace initializer also read `operation.userId` before entry captured the
operation. Its input now reads the admitted request directly; entry retains that
same request for replacement/drain correlation. Existing startup tests assert the
identity actually received by the initialization boundary. Unreachable handlers
were removed from the final startup and creation-owner states.

The forms/write assessment token already accounts for the entry increment, and
creation-owner already reads its admitted binding directly; those inputs were
reviewed and retained. Session-readiness's retry entry only queues a report and
does not patch its invocation binding.

Validation: the composed-form regression, readiness adapter and workspace startup
suites pass 22 tests. Library TypeScript checking and declaration packaging pass.
This validates these bindings, not every consumer workflow or native browser race.
