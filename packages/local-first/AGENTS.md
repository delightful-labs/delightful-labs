# Local First project guidance

Read the [workspace entry](../../AGENTS.md) and shared guides first. The stricter
common engineering/review requirements apply. Follow the local
[constitution](.specify/memory/constitution.md), active feature selector and
public contracts; no consumer constitution or domain schema becomes library policy.

- Jazz is the sole required v1 backend. Keep SDK access behind documented
  identity/workspace/data integration boundaries; presentation and ordinary
  workflows consume capabilities. Independent plugins, universal schemas and a
  second backend remain deferred. Preserve app-required permissions/durability.
- UI owns generic controls/theme; this library owns reusable identity/workspace
  composition and local-first lifecycle contracts. Consumers own domain policies,
  schemas and operations. Do not copy consumer statecharts into the foundation.
- Read local [workflow extensions](.specify/memory/xstate.md) and the pinned-v6
  [implementation](specs/003-verified-backup/xstate-v6-implementation.md) /
  [design review](specs/003-verified-backup/xstate-v6-design-review.md) for generics,
  factory and native resource qualification.
- Local [localization](.specify/memory/localization.md),
  [composition](.specify/memory/components.md) and [CSS](.specify/memory/css.md)
  details supplement the shared guides. Paraglide compositions expose supported
  contracts; consumers do not reach into private catalogs.
- Use Oxfmt/Oxlint and the scoped package/consumer/native/browser commands. The
  constitution's implementation-review and commit/publish approvals remain in
  effect; the stricter shared baseline now applies to all workspace projects.
