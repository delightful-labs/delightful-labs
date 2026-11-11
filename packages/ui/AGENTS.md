# UI project guidance

Read the [workspace entry](../../AGENTS.md) and applicable shared guides first.
The user's stricter common engineering rules apply here, including implementation
review before tests, explicit dependency/copy/visual approvals and strict new-code
types. Current task-specific authorization retains its scope.

- UI owns generic presentation. Interaction machines and their DOM resources
  belong to the mounting component; application/domain work belongs to the
  worker-owned application runtime. Preserve native cleanup and subscriptions.
- Use the pinned published v6 package. Read the installed docs and the local
  [migration record](docs/xstate-v6-migration.md) / [design audit](docs/xstate-v6-design-review.md)
  for component contracts and generated-testing qualification.
- The [README](README.md) documents public props/exports and explicit theme
  choices. Keep one property-registration owner; consumers choose one theme.
- Use this project's Prettier/Svelte configuration and its existing commands.
  Behavioral/native accessibility tests follow the shared testing guide; do not
  assert computed/inline CSS or styling classes.
