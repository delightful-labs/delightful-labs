# Delightful UI: Svelte 5 migration handoff

Prepared on 2026-10-12 for a fresh chat in the Delightful UI repository.

## Current status

Tooling and all twelve public components now use Svelte 5. Native Select, Textarea, Checkbox, and InputDate are implemented. Locale objects, UIProvider, Microcopy, and translation defaults are removed. Storybook is restored with the Svelte/Vite framework. See [breaking changes](./svelte-5-breaking-changes.md) and the repository README for current APIs and commands.

The optional theme uses consistently prefixed --dui-* properties, green accents, and explicit light/dark modes. The presentation and [Clipper rewrite branch](https://github.com/delightful-labs/delightful-clipper/tree/rewrite) remain style references; exact application page layouts are not carried over. Breaking API/style changes are accepted.

The last approved implementation passed 33 SSR checks and 42 Chromium scenarios. Subsequent checkbox focus/error-color and caller-owned required-label fixes await runtime validation after implementation review. The absolute Details hidden issue remains pending. Packed-package consumption, broader browser/assistive-technology coverage, and release preparation remain outstanding. Finance integration is deferred at the user's request.

Per-iteration review files have been removed at the user's request. The original assessment below is historical, including its old dependency versions, migration sequence, and checkout baseline; use the current status above rather than restarting completed phases.

The approved keypad plan is underway. Button's flat variant and responsive Storybook key example are reviewed; all 33 SSR checks and 24 Storybook browser scenarios passed before NumberKeypad was added. NumberKeypad is now implemented for review, with aspect-ratio sizing, caller-supplied labels, disabled states, and typed digit/decimal/backspace/next commands. Its runtime coverage must wait for implementation review. Keyboard mode, focus/caret handling, amount editing, and currency parsing remain consuming-application responsibilities. No Finance integration is implemented.

## Start here in a new chat

The user wants to modernize their existing Delightful UI library so it can be used in Delightful Finance. They also want some of the visual feel from their local-first UX presentation. Work belongs in this library repository first; introducing library components into the finance application comes later, after review.

The user requested this handoff after approving the migration direction. The current session's requested work was to verify the local checkout against GitHub and add this document. That work is complete. No dependency upgrades or component migrations have been implemented yet.

**Recommended first implementation task:** upgrade the library's tooling, Svelte dependency/peer range, package configuration, and development scripts. Establish a buildable Svelte 5 library while retaining existing component APIs and styles initially. Present that concrete tooling change for review before starting Button or another component. A full runes/API rewrite is a later task. Do not interpret the full sequence below as permission to implement every phase without review.

Suggested opening message for the new chat:

> Read docs/svelte-5-migration.md and the repository's working instructions. Start with the tooling and packaging upgrade described there, preserving existing component behavior for this first review. Show me the changes before moving on to components. Do not commit or publish, and do not add or run tests until I have reviewed the implementation.

## Repository locations and verified baseline

- Library working directory: `/Users/matthewjamesderocher/Projects/delightful-ui`.
- Library origin: `https://github.com/delightful-labs/delightful-ui.git`.
- Consumer application: `/Users/matthewjamesderocher/Projects/delightful-finances`, project name **Delightful Finance**.
- Consumer GitHub organization: `https://github.com/delightful-labs/`.
- Control style reference: `https://github.com/delightful-labs/local-first-ux-patterns`.
- Application-layout reference and existing consumer: `https://github.com/delightful-labs/delightful-clipper/tree/rewrite`.
- This document's initial assessment originated in the consumer application's `docs/reviews/delightful-ui-migration.md`; this handoff includes that assessment so the new chat does not need its conversation history.

On 2026-10-12, `git fetch origin` completed in the local library checkout. Both HEAD and origin/main were `5af7b609ab9b9aed44ad7d2d3af66a49fb5ad139`. The checkout was on main, zero commits ahead/behind, with no tracked differences or untracked files before this document was added. No reset, merge, or pull was necessary. No migration branch has been created.

Pre-existing ignored `node_modules`, `dist`, and `.svelte-kit` directories were left intact. Their contents have not been verified against a fresh installation/build. The library has both npm and pnpm lockfiles; choose one package manager deliberately rather than treating both as current. The consumer application uses pnpm.

## Working agreements carried into this migration

These are explicit user preferences from the originating session. Read any repository or parent AGENTS.md before implementation and resolve conflicts with the user's latest instructions.

- Work on one task at a time, present the result, and wait for review before starting the next task. Add or change at most one route or component in a review cycle. A tooling task may change the necessary configuration files together.
- Components should be small and reusable. Prefer native semantic HTML controls and ordinary browser behavior. The user rejected a previous headless-control implementation because it produced unusable unstyled selects; do not introduce another control library as part of this migration.
- Use existing libraries and browser APIs where appropriate. Remove unused helpers and duplicate logic instead of retaining speculative APIs for future features.
- Default form controls should support uncontrolled form submission through FormData. Avoid per-field parent bindings unless the caller needs them; library binding can remain an explicit optional API.
- Keep styling tied to the approved Clipper application-layout and presentation control references. Do not invent a new visual identity, add decorative copy, or apply presentation-sized typography throughout the finance application. Review Button's appearance before spreading the theme to other components.
- Use strict TypeScript, inferred/native attribute types, and clear narrowing. Avoid `any`, TypeScript `as` casts, switch statements, and case clauses in authored production code.
- Do not add or run tests before the user reviews and approves the exact implementation being tested. After approval, add relevant unit and Playwright coverage. Package builds, static compiler checks, and type checks can support the implementation review; do not mistake these for runtime validation.
- Use the repository's Prettier conventions and format only changed files. Its current configuration/scripts contain obsolete flags that belong in the tooling cleanup.
- Announce any development server before starting it and provide its URL. Check for existing servers and avoid competing for the finance application's port (which has used 5173). No server was started for this handoff.
- Never commit, push, publish, or release without explicit user authorization. Do not overwrite or discard the user's local changes.

## Consumer requirements and open decisions

Delightful Finance currently uses Svelte 5, SvelteKit, TypeScript, Jazz for data, Paraglide for localization, and native HTML controls. Money remains integer minor units, and date-only values remain YYYY-MM-DD strings. The UI library should stay reusable: do not add finance-specific data schemas, Jazz, or Paraglide as required runtime dependencies simply to support this consumer.

The user has approved the presentation as a style reference, but final application-scale typography, border/shadow strength, and complete theme tokens still need a visual review. Prefer CSS custom properties so the application can tune those choices.

Decisions to discuss before changing the corresponding API:

- Whether to retire the library's locale-object/Microcopy API in favor of caller-provided translated strings and snippets. The assessment recommends the simpler API; the user has not yet approved removing the old one.
- Which existing public APIs should retain compatibility and which will change in a documented release.
- Whether current Storybook is part of the first tooling task or a subsequent documentation task. It should not silently become a full story/component rewrite before the tooling change is reviewed.
- Which missing native form controls to add after existing components are modernized. Do not add several components in one review cycle.

## Sources and scope

- [Delightful UI](https://github.com/delightful-labs/delightful-ui), checkout `5af7b60`, last commit 2023-09-21; reviewed in `/tmp/delightful-ui-review-20261012`.
- [Local-first UX patterns](https://github.com/delightful-labs/local-first-ux-patterns), checkout `965a17d`, last commit 2026-01-26; reviewed in `/tmp/local-first-ux-patterns-review-20261012`.
- [Svelte 5 migration guide](https://svelte.dev/docs/svelte/v5-migration-guide), [library packaging](https://svelte.dev/docs/kit/packaging), and [Storybook migration guide](https://storybook.js.org/docs/releases/migration-guide).

During the assessment, neither reviewed checkout nor application components were modified. No dependencies were installed into the review checkouts, no servers were started, and no tests were run. This handoff has now been added to the verified local library checkout; it does not implement the migration.

## Assessment

Updating the library is feasible without replacing it. It has ten Svelte components, seven of which are publicly exported: Button, Details, Dialog, InputText, InputNumber, LoadingSpinner, and ScreenReaderText. InputWrapper, Microcopy, and UIProvider are internal components.

The library's package version is `0.0.24`; its peer dependency targets Svelte `^4.2.0`. Development tooling includes SvelteKit 1, Vite 4, Storybook 7, and the Svelte CSF addon 4.

Current versions read directly from the npm registry during this review:

| Package                    | Latest version |
| -------------------------- | -------------- |
| Svelte                     | 5.57.2         |
| Vite                       | 8.3.4          |
| Svelte Vite plugin         | 7.3.1          |
| SvelteKit                  | 3.0.1          |
| Svelte package tooling     | 3.0.0          |
| Storybook                  | 10.6.1         |
| Storybook Svelte CSF addon | 5.1.5          |

SvelteKit is development/documentation infrastructure here. A modern component package does not require Delightful Finance to upgrade its own SvelteKit version. If the library's development app moves to current SvelteKit, its toolchain needs Node 22.17 or newer and TypeScript 6.

## Compatibility evidence

All ten library components compile with the application's Svelte 5.57.2 compiler in client/legacy mode. There were no compiler errors and two warnings for self-closing non-void div elements in LoadingSpinner.

This establishes syntax compatibility only. It does not establish resolved package imports, generated types, SSR/hydration behavior, working Storybook builds, accessibility, or runtime correctness. Those need review and validation during implementation.

Svelte 5 supports legacy components alongside runes components. We can update build tooling first and migrate one component at a time rather than combining a dependency upgrade with every API change.

## Integration and correctness findings

1. **Inputs cannot serve the current FormData workflow reliably.** InputText and InputNumber expose individual props but do not forward `name`, disabled state, or arbitrary native attributes. Prefer typed native HTML attributes and an uncontrolled default path; make value binding optional. Use a shared field wrapper rather than duplicating attribute lists and validation machinery. The library currently has no Select, Textarea, Checkbox, or Date input component.
2. **Localization duplicates application responsibilities.** Button and Dialog expect locale-keyed objects and use Microcopy/MicrocopyFactory rather than ordinary strings or child content. Delightful Finance already uses Paraglide. The simplest integration would accept localized strings and snippets from callers. Retiring the old localization API is a deliberate public API decision, not a mechanical Svelte migration.
3. **Localization subscriptions are not disposed.** MicrocopyFactory subscribes to the preferred-language store without retaining or disposing the unsubscribe function. Microcopy can call that factory again reactively. UIProvider also has a misspelled `preferred_langauge` prop and is not exported from the package entry point.
4. **Dialog state and IDs need repair.** Every instance uses `id="title"`. Native close/cancel events are forwarded but do not reset the exported `show` state, which can leave the component's state out of sync after Escape. Use unique hydration-safe IDs and native modal behavior, with consistent close callbacks and optional binding. The presentation's separate Dialog uses `show()` and a manual backdrop; copy its visual ideas only, rather than carrying that implementation into a reusable modal.
5. **Input defaults are not safe identifiers.** Default titles use Math.random; IDs are derived from labels. Repeated labels can produce duplicate IDs, and random defaults risk server/client mismatches. Use Svelte's `$props.id()` with an explicit caller-provided ID override.
6. **Numeric sanitization is unsuitable for currency.** InputNumber's maxlength path uses parseInt, which can discard a decimal fraction. Money entry should remain text with decimal input mode and the application's existing parser/validator.
7. **Public APIs need native composition.** Button lacks child content and general attribute forwarding. Move to typed `$props`, callback events, and snippets. Replace slots and event dispatchers incrementally; use `$bindable` only for intentionally bindable values. Avoid introducing another validation or localization framework inside the library.
8. **Packaging and examples are stale.** Add a default export condition alongside types/svelte, verify generated declarations and internal aliases, choose one package manager/lockfile, and align README publishing instructions with `dist`. Storybook's CommonJS configuration and Meta/Story/Template stories need migration. The InputText story references `Text` instead of its imported component. Prettier still has removed plugin-search options.
9. **Existing tests provide little evidence.** The unit test checks arithmetic; the Playwright test expects the starter page heading rather than the current demo. Add meaningful component, form-submission, and dialog coverage after the implementation being covered has been reviewed.

## Presentation style to carry forward

The [global stylesheet](https://github.com/delightful-labs/local-first-ux-patterns/blob/main/src/routes/styles.css) and [Button](https://github.com/delightful-labs/local-first-ux-patterns/blob/main/src/lib/components/Button.svelte) define a recognizable direction:

- Source Code Pro, black-and-white surfaces, square control edges.
- Strong borders and hard offset shadows; hover inversion and a pressed-button offset.
- Separate success, error, warning, and information colors.
- Clear keyboard focus indicators.

Put these decisions into reusable CSS custom properties and a theme, with practical control sizing for forms and tables. Do not copy the presentation's large heading sizes, global margin/padding reset, or FlowBlock placeholder font into financial data displays. Check disabled, focus, error, and reduced-motion states during component review.

## Recommended sequence

1. Upgrade Delightful UI's dependencies, package configuration, and build scripts. Establish a buildable Svelte 5 package while retaining legacy component APIs initially. Review this tooling change before component work.
2. Modernize Button as the first component and demonstrate the presentation-inspired theme there. Review its appearance and API.
3. Modernize the field/input components for native FormData submission, then add missing native controls one component per review cycle.
4. Repair and modernize Dialog, Details, and supporting components; resolve the localization API deliberately.
5. Consume a locally packed library build in Delightful Finance before publishing a release. Introduce styles to the application one reviewed component at a time.
6. After implementation approval, add the relevant unit and Playwright coverage and validate package consumption, forms, keyboard interaction, dialog close/focus behavior, and SSR/hydration.

Public API changes should be documented in a release. Do not publish or commit without the user's authorization.
