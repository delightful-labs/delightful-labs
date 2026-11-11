# Agent guidance

## State machines

- Use the pinned XState v6 dependency and its schema/function model for machine changes. See [the migration specification and implementation notes](docs/xstate-v6-migration.md).
- Review v6 changes against the installed package docs (`docs/agents.md` and `docs/api-stability.json`) and [the design audit](docs/xstate-v6-design-review.md). Use published XState without patches or declaration overrides.
- Keep workflow decisions visible in transitions with descriptive predicates, return immutable context patches, and queue effects with `enq`. Preserve context-update order when composing patches.
- Interaction machines and their DOM resources belong to the mounting UI component; retain explicit subscription and browser-resource cleanup.

## Development servers

Follow the shared [workspace server guidance](../../AGENTS.md#working-in-the-workspace).

## Tests

- Test user-observable behavior, native HTML state, and accessibility semantics rather than styling implementation details.
- Do not assert computed CSS values, inline style values, or the presence/absence of CSS classes in unit or Playwright tests.
- Avoid selecting elements by component styling classes. Prefer role, label, text, and native attributes; use stable IDs or explicit test attributes only when no semantic locator is suitable.
- Replace style assertions with behavior checks where possible: for example, verify keyboard interaction, focus, visibility, accessible names/descriptions, layout bounds, or scrolling instead of color, spacing, animation, or specific CSS properties.
- Tests may change styles to set up a behavior scenario (such as a longer animation duration), but should not assert the style values themselves.

- For v6 machine testing, follow the generated-testing section in `docs/xstate-v6-design-review.md`: prefer `@xstate/test` campaigns with independent behavioral oracles; preserve integration tests and existing implementation-review gates.
