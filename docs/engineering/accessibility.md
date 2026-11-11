# Presentation, accessibility and CSS

Use semantic native HTML and established UI primitives. Preserve accessible
names/descriptions, focus order/return, keyboard and pointer dismissal, native
form submission, bounded layouts and usable scrolling. Motion/spinners alone
must not communicate state. Decorative icons are hidden from assistive technology;
feedback has one announcement owner, with mounted status regions for updates.
Keep sensitive recovery material out of announcements and clear transient secrets
on dismissal, unmount, terminal outcomes and scope replacement. A dialog closing
is not evidence that a write or identity change was rolled back.

Use caller-owned localized labels and typed callbacks/snippets. Pure presentation
receives data and intent callbacks; it does not own SDK subscriptions, actor
policy or multi-fact domain eligibility. Keep simple draft/disclosure state local
and give complex forms an explicit workflow owner. See state-machine guidance.

Use native CSS/custom properties and UI defaults; do not introduce Tailwind,
decorative app skins, fonts, typography choices or visual direction without user
approval. UI owns generic controls/theme design; consumers own structural page
layout. Existing approved styling is retained, not a mandate to remove it.
Website typography remains explicitly owned by Matt.

Use public props, snippets and documented tokens. Do not reach into another
component's styling classes. UI owns --dui-* registrations in the component or
shared theme-property file; consuming foundations/apps must not redefine that
registry. A new public token requires documented scope, inheritance, accepted
values and fallback. Typed registrations need independent initial values and
must preserve intended fallback chains. Each registration has one owner.
Import one explicit theme per application; shared libraries do not silently
import a global reset. Website/Local First Storybook retain theme-classic.css;
other existing consumers retain their chosen default theme.

Accessibility/behavior tests follow [testing](testing.md): semantic locators,
native state, focus, visibility, bounds and scrolling, with no computed-style,
inline-style or class assertions. Review actual native cleanup and framework
hook ordering, including repeated opening/closing and interrupted workflows.
