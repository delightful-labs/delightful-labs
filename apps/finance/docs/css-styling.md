# CSS styling boundaries

Use native Svelte scoped CSS for elements rendered by the component. Prefer a
single class selector; retain attributes and pseudo-classes for states. Passing a
class through a child component does not make that child's markup locally scoped.

For AppLink consumers that own link presentation, use its `render(destination)`
snippet to render a native anchor. Keep destination/query construction in AppLink
and place anchor attributes, callbacks and scoped styles at the call site.

Customize Delightful UI through its documented CSS variables and component props.
Finance uses the public Drawer panel-border token. Details provides a default
padded body and a `content` snippet that replaces it with consumer-owned markup.
Use its existing `caret(open)` snippet for custom decorative caret layout.
Keep absolute positioning/overflow and native disclosure behavior library-owned.
Do not select `.inline-panel`, `.details-caret` or `.details-content` in application
styles. Prefer snippets for structural layout replacement; reserve public tokens
for theme values and simple sizing rather than arbitrary layout configuration.

Use AppIcon's `navigation` variant for the shared 20px navigation icon size and
trailing spacing. Callers keep their glyph, accessibility attributes and callbacks.
Other icons retain their default 1em dimensions or explicit native style attributes.

Keep necessary global CSS in readable native `:global { ... }` blocks:

- AppIcon owns its forwarded SVG classes because glyphs are imported components.
- AppTopMenu and AppDrawer target their explicit application root classes to set
  library tokens and style their composed controls/logo. Avoid private library
  implementation classes.
- FormContent bounds its cross-snippet button rule with `.form-controls.fill`.
  Preserve its flexible wrapping and button sizing rather than introducing wrappers.
- Transaction view-transition pseudo-elements are browser-owned and require global
  selectors. Keep their animation/keyframe names and reduced-motion handling intact.

Do not add global rules solely to silence an unused scoped-selector warning.
First check which component owns the element. Do not introduce a styling library
for these boundaries; native CSS, snippets, component variants and custom properties
cover the current requirements.

Keep pixel, color, spacing and styling-token checks temporary during a styling
refactor. Retain permanent tests for user-observable behavior, semantics and
accessibility; avoid adding lasting test cases solely to lock down appearance.
