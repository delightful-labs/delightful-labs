# Agent guidance

## Development servers

- Start development servers on the network by default (`0.0.0.0`), unless the user explicitly requests localhost-only access. Provide both localhost and LAN URLs.

## Tests

- Test user-observable behavior, native HTML state, and accessibility semantics rather than styling implementation details.
- Do not assert computed CSS values, inline style values, or the presence/absence of CSS classes in unit or Playwright tests.
- Avoid selecting elements by component styling classes. Prefer role, label, text, and native attributes; use stable IDs or explicit test attributes only when no semantic locator is suitable.
- Replace style assertions with behavior checks where possible: for example, verify keyboard interaction, focus, visibility, accessible names/descriptions, layout bounds, or scrolling instead of color, spacing, animation, or specific CSS properties.
- Tests may change styles to set up a behavior scenario (such as a longer animation duration), but should not assert the style values themselves.
