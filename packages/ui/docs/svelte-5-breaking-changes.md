# Svelte 5 migration: breaking changes

This is the current migration reference. The migration has not been published; package version 0.0.24 is still the old release number, and a release version remains to be chosen.

## Tooling and package

Consumers need Svelte ^5.57.2. Library development uses Node 22.17+ on the 22.x line or Node 24+, pnpm 10.22.0, and TypeScript 6. Use the pnpm lockfile; the npm lockfile was removed.

Import the twelve public components from delightful-ui. The package exports generated code/types from dist. Import optional global styles from delightful-ui/theme.css. Source development uses private #lib imports; consumers do not use those paths.

Storybook is restored with the Svelte/Vite framework and current Svelte CSF stories. It documents the component library independently of the SvelteKit demo. Old Meta/Template/slot stories and obsolete Storybook addons/configuration are replaced.

Button now supports `variant="raised"` (default) and `variant="flat"`. Flat defaults omit shadows and pressed movement. NumberKeypad adds a responsive three-column key grid emitting typed commands through `onkey`; its consuming application owns editing, validation, and keyboard mode. See the README for labels, disabled states, and aspect-ratio styling.

## Native composition and events

Use native attributes and callback props such as onclick instead of legacy component on:click handlers. Components accepting content use Svelte 5 child snippets. Application content supplies meaningful labels; the library does not translate or infer action text.

Form controls forward native attributes, including name, disabled, required, and callbacks. They support native FormData without parent bindings. Binding remains optional where explicitly supported. Money remains an application concern; InputNumber is a native numeric input, not a currency parser.

## Component changes

| Component        | Current API and required migration                                                                                                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button           | Supply string text or child content. Children take precedence. Native callbacks/attributes pass through. Default type is button. No default action label.                                                                                                                                                                          |
| InputText        | Replace the old visible title API with required label. Native title remains a tooltip. Use name and optional defaultValue for uncontrolled forms; bind:value is optional. list is a native datalist ID. Use browser constraints instead of removed digit filtering/custom validation.                                              |
| InputNumber      | Required label, native name/min/max/step, optional defaultValue and numeric bind:value. Empty binding is undefined. Remove character-length truncation; it no longer parses/truncates numeric values with parseInt. hideArrows remains optional.                                                                                   |
| Details          | Use string/snippet summary, children, native callbacks, and optional bind:open. Default position is inline. position="absolute" and align="start"/"end" provide bounded anchored panels with outside-pointer and Escape dismissal.                                                                                                 |
| Dialog           | Replace show with open, title with required heading, and title_heading_level with headingLevel. heading accepts a string/snippet. Supply your own trigger and explicit close control; button_title and bundled trigger are removed. Use native onclose/oncancel/ontoggle callbacks. Optional bind:open follows native modal state. |
| LoadingSpinner   | Optional string text is no longer bindable and has no default; hidden text renders only when a nonempty string is supplied. Native div attributes pass through. Default role is status. Reduced motion shows a static ring.                                                                                                        |
| ScreenReaderText | Child snippets replace the legacy slot; native span attributes pass through. Use for supplementary text, not interactive controls.                                                                                                                                                                                                 |

Input defaults are seeded once, including server rendering, and native form reset restores them. Input IDs use explicit native id or generated hydration-safe IDs. Removed createHtmlId/createFieldTitle helpers should not be imported.

Dialog opens through showModal, not an SSR open attribute. Native dialog-method forms supply return values. A new opening clears the previous return value. Native closedby="any" requests browser light dismissal; always provide an explicit close control. The old global clickOutside helper is removed.

Required labels no longer append English “(required)” text. Supply any visible marker in caller-translated label copy. Native required state and validation remain.

## Localization removal

Translate labels in the application before passing them. Locale-object Button text and Dialog headings are removed, along with UIProvider, Microcopy, MicrocopyFactory, LocalizedString, LocalizedStrings, DEFAULT_LANGUAGE, and DEFAULT_LABELS. There is no preferred-language context or provider custom-label registry.

## Styles

Old unprefixed component CSS overrides have been replaced without compatibility aliases. Use shared --dui-* tokens and documented component properties: --dui-button-_, --dui-input-_, --dui-details-_, --dui-dialog-_, and --dui-loading-spinner-*.

The optional theme supplies green accents, base fonts/colors, spacing, native accent color, links, and focus styles. It also changes body margin and global box sizing when imported. Source Code Pro falls back to monospace; no font files are bundled. Set data-dui-theme="dark" on html for the explicit dark theme.

Component styles define the available custom property names. No application page-layout components are supplied.

## Still deferred

Delightful Finance integration and packed-package consumption are deferred at the user's request. Native Select has been added, using required label, caller-owned options, string/array values and defaults, optional binding, and shared field/input styling. Native Textarea has also been added with required label, native multiline attributes, string defaults, optional binding, and shared field/input styling; Native Checkbox has been added with required label, checked/defaultChecked, optional binding, and successful-control FormData behavior; Native InputDate has been added with required label, string value/defaultValue/min/max, optional binding, and native date-only FormData; No JavaScript Date or timezone conversion is performed. Release version selection, release notes, publication, and broader browser/screen-reader validation remain pending. Never publish or commit without explicit authorization.
