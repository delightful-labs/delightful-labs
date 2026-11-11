# Local First workflow extensions

Read the authoritative [shared state/resource guide](../../../../docs/engineering/state-machines.md)
and [scope/approval rules](../../../../docs/engineering/scope.md) first. Follow the
library constitution and active feature for its public contracts. The shared
stricter engineering rules apply; no consumer domain model becomes a library rule.

## Library implementation contracts

Keep reusable machines under `src/lib/machines/`. Prefer direct actor sources and
`createInvoke` where required for generic inference. The form writer's registered
source accommodates its native leaf/consumer persistence union. Group related
generic lifecycle facts in immutable records and retain complete patches.
Explicit output mappers may express generic union contracts the beta cannot infer;
never erase them with assertions or XState declaration patches.

Keep commands in the state owning the recipient invocation. Nested handlers must
preserve interruption/binding effects, and parallel regions retain control-state
precedence. Consumers receive public typed reports/factories, not private actor
paths or direct SDK handles. UI composition, local usability and cleanup follow
the shared guide; library locale ownership remains in the local localization file.

The pinned v6 implementation/design-review records under
`specs/003-verified-backup/` own version-specific qualification. Read the exact
installed `xstate/docs` guides before relying on an API; historical v5 syntax is
not current authoring instruction.

## Extracted workflow dependencies


Forms, workspace initialization/startup, durable explicit-creation ownership/recovery, profile
editing and restoration coordination expose typed factories under documented public subpaths.
Consumers inject policy/schema/storage capabilities rather than fork these statecharts.
Caller-supplied promise capabilities still must be leaf operations; the factory boundary is not
an exemption from recursive workflow review. Host application lifetime owns a Jazz startup
registry, and layout attachments do not acquire competing sessions. See `docs/next-app.md`.
