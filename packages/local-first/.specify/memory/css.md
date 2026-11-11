# CSS and theming memory

Read before styling library compositions or introducing public CSS properties.
Adapted on 2026-10-31 from DUI `9bc5405`, especially README.md, theme.css,
ButtonContent.svelte, Dialog.svelte, and StatusMessage.svelte. DUI observations are
reference conventions, not authorization to redesign its components.

## Ownership and composition

Use native CSS and custom properties; no Tailwind. Reuse DUI presentation and documented tokens.
Library compositions own necessary internal layout; consumers own page layout, responsive placement,
and visual direction. Keep the initial composition wireframe-like until a visual direction is approved.
Prefer scoped layout with grid/flex and gap. Preserve logical DOM order and use logical dimensions
where appropriate. Do not reach into DUI internals using descendant selectors or styling classes.
Use public props, snippets, native class/style forwarding, and documented custom properties.

DUI's theme is optional and global when imported: it changes body/control defaults, colors, typography,
and focus treatment. Its `dui-theme` cascade layer allows application overrides. The library must not
silently import a global reset/theme or force consumer styling. Preserve usable fallbacks without it.
Use documented DUI spacing/color/typography tokens rather than inventing a parallel design system.

## Custom property registration

DUI registers component properties in their owning component and shared tokens in theme.css.
Registrations are global even when declared in a scoped Svelte style block. Each property has one
registration owner; consuming components must not register it again. Never redefine `--dui-*` tokens
or registrations in this library. New library-owned public properties need a distinct documented
namespace selected during interface design and one registration owner.

For a genuinely new public property, document inheritance, purpose, accepted values, and fallback.
Typed `@property` declarations require computationally independent initial values. Universal syntax
without an initial value can preserve contextual/complex values but provides no narrow validation.
Preserve inheritance for intended ancestor overrides and fallback chains. Do not copy typed defaults
that would mask contextual fallbacks or relative theme values. Registration is an API decision, not
necessary for every local variable.

## Accessibility and verification

Retain native focus, dialog/popover behavior, visible labels, viewport bounds, and usable scrolling.
Motion or a spinner cannot be the only indication of state. Follow DUI's decorative icon/spinner
conventions so feedback has a single announcement owner. Do not introduce decorative styling as part
of infrastructure extraction.

After implementation approval, test behavior, native state, accessibility, focus, visibility, bounds,
and scrolling. Do not assert computed/inline CSS or class names and do not select elements by styling
classes. Styles may set up a behavior scenario without becoming the asserted result. No test execution
is authorized by this memory update.
