# Delightful UI

A Svelte 5 component library undergoing an API and styling migration. See [breaking changes](docs/svelte-5-breaking-changes.md) for the current migration reference.

## Pull request titles

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for pull request titles: `<type>[optional scope][!]: <description>`.

Examples: `feat(details): animate opening and closing`, `fix: restore keyboard focus`, and `docs: clarify setup`. Use `!` for a breaking change and explain the change in the PR description. Choose a title that describes the complete change being merged.

The `Conventional PR title` GitHub Actions check validates titles when a PR is opened, edited, reopened, updated with commits, or marked ready for review. The `Conventional PR titles` repository ruleset requires this check before merging into `main`.

## Development

Use Node.js 22.17+ on the 22.x line, or Node.js 24+, and pnpm 10.22.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm build` builds the development app and the library. `pnpm package` generates `dist`, including declarations, and validates package metadata with publint. `pnpm check` runs static Svelte and TypeScript checks. `pnpm lint` checks formatting and ESLint; format only the files you change with `pnpm exec prettier --write <files>`.

Tests require implementation review and approval before they are added or run. After approval, use `pnpm test:unit --run` for SSR/unit checks and `pnpm test` to build current source and run Chromium scenarios against a temporary production preview on port 4174.

Source imports use `#lib` and `#lib/*`, declared in `package.json`. Public package imports remain `delightful-ui` and `delightful-ui/theme.css`.

## Theme

Import the optional global theme once in your application layout:

```js
import 'delightful-ui/theme.css'
```

The theme supplies green accents (`#94ff47`), system-preference light/dark surfaces, shared spacing, and base typography/media/focus styles. Button hover uses green with dark text. Source Code Pro falls back to monospace; font files are not bundled. Without this import, components retain their own styling fallbacks.

Component-specific `@property` registrations live in the owning component's `<style>` and load with that component, independently of the optional theme. Shared color, spacing, typography, border, shadow, and pressed-offset registrations live in `theme.css`. Each property has one registration owner, even when other components consume it. For example, Button owns `--dui-button-*`, InputWrapper owns shared field/input properties, and LoadingSpinner owns its spinner properties.

Registrations remain global CSS definitions; component placement does not scope their names. Use unique `--dui-*` names, enable inheritance for ancestor overrides, and preserve existing fallback chains. Properties using universal syntax (`"*"`) without initial values preserve contextual or complex values; those registrations do not validate a narrower type. Typed registrations use computationally independent initial values. Theme declarations still provide relative units, aliases, fluid spacing, and light/dark colors.

Field labels use the shared `--dui-font-size-sm` token (`0.875rem`, with the same fallback without the theme). Override `--dui-field-font-size` to customize label size independently of input text.

Spacing primitives use rem units: `--dui-spacing-xxs` (0.25rem), `--dui-spacing-xs` (0.5rem), and `--dui-spacing-sm` (0.75rem) stay constant across viewport sizes. Larger tokens use `clamp()` to grow smoothly between viewport widths of 20rem and 80rem: `--dui-spacing-md` (1–1.25rem), `--dui-spacing-lg` (1.5–2rem), `--dui-spacing-xl` (2–3rem), and `--dui-spacing-xxl` (3–5rem). Values stay within those bounds outside that viewport range. The existing `--dui-space-xs`, `--dui-space-sm`, `--dui-space-md`, and `--dui-space-lg` tokens alias `--dui-spacing-xs`, `--dui-spacing-md`, `--dui-spacing-lg`, and `--dui-spacing-xl`, respectively. Components retain their own overrides and honor legacy spacing overrides where previously supported. Shared gaps and padding now use the spacing primitives; medium and larger values grow on wider screens. Avatar Input’s square-to-button gap uses `--dui-spacing-xs`, with a 0.5rem fallback without the theme. Override `--dui-avatar-gap` to customize that gap.

The theme follows the system color preference automatically. Set `data-dui-theme="dark"` or `data-dui-theme="light"` on the root `<html>` element to override it; remove the attribute to follow the system again. Override `--dui-*` properties on the root for application-wide theming, or `--dui-button-*` properties to customize Button.

The stylesheet uses the `dui-theme` cascade layer so ordinary application CSS can override its defaults. It is global when imported: it changes body margins, colors, fonts, box sizing, links, focus indicators, and native control fonts/accent colors. It contains no page layout, heading scale, or form-control replacement.

## Typography and Heading

The compact app typography scale uses `--dui-font-size-xs` (0.75rem), `--dui-font-size-sm` (0.875rem), `--dui-font-size-md` (1rem), `--dui-font-size-lg` (1.125rem), `--dui-font-size-xl` (1.25rem), and `--dui-font-size-xxl` (1.5rem). Sizes stay constant across viewport widths and scale with the root font size. Existing small text retains its 0.875rem size.

```svelte
<Heading level="h1">Account settings</Heading>
<Heading level="h2" size="sm">Notifications</Heading>
```

`Heading` renders a native h1–h6, defaults to `level="h2"`, and accepts content through its children snippet. Default visual sizes map h1 → xxl, h2 → xl, h3 → lg, h4 → md, h5 → sm, and h6 → xs. Optional `size` overrides appearance independently of the semantic level; choose `level` for document structure. Native attributes, events, class, and style pass through. Default margins are zero, so layout owns spacing. Heading uses the typography tokens with matching fallbacks when the optional theme is absent. Customize `--dui-heading-font-family`, `--dui-heading-font-size`, `--dui-heading-font-weight` (600), `--dui-heading-line-height` (1.3), and `--dui-heading-color`.

`Heading` and `Text` accept an optional `align` prop: `start`, `center`, `end`, `left`, `right`, or `justify`. Omit it to inherit alignment. Prefer `start` and `end` for direction-aware layouts. Inline `Text` (`as="span"`) follows the containing block’s alignment; this prop does not position the span within its parent. Use paragraph Text or set alignment on the containing block to align a line of text.

## Text

```svelte
<Text>Manage your account preferences.</Text>
<Text as="span" size="sm">Last saved a moment ago</Text>
<Text align="center">Centered paragraph</Text>
```

`Text` renders a paragraph by default; `as` accepts `p` or `span`. Its optional `size` accepts `xs`, `sm`, `md`, `lg`, `xl`, or `xxl` and defaults to `md` (1rem). It shares the `--dui-font-size-*` scale with Heading, including fallbacks without the optional theme. Children provide content; native attributes, events, class, and style pass through. Default margins are zero. Font family uses `--dui-font-family-body`; customize `--dui-text-font-family`, `--dui-text-font-size`, `--dui-text-line-height` (1.5), or `--dui-text-color`.

## Button

```svelte
<Button>{saveLabel}</Button>
<Button text={cancelLabel} />
```

Labels are caller-provided strings or child snippets. Button no longer accepts locale objects or reads UIProvider; absent content has no generic English fallback. Provide an accessible label for every button. To use an SVG icon, place its path inside `Icon`; icons are decorative by default and hidden from assistive technology. If the SVG itself conveys meaning, provide `label` for an `aria-label`, `title` for a native SVG `<title>`, or `aria-labelledby` referencing visible text. For an icon-only button, label the button with its action and leave the icon decorative.

```svelte
<Button>
	<Icon style="width: 1em; height: 1em; vertical-align: -0.125em;">
		<path d="M5 12h14M13 6l6 6-6 6" />
	</Icon>
	Continue
</Button>
```

Use a 24×24 viewBox unless the source SVG specifies otherwise. The consuming app supplies the SVG paths; `Icon` provides shared SVG defaults and accessibility behavior.

```svelte
<Icon label="Warning">
	<path d="M12 3 2 21h20L12 3Z" />
	<path d="M12 9v4m0 4h.01" />
</Icon>
```

Field labels render exactly as supplied. Native `required` validation remains; supply your own translated visible marker in the label when needed. Shared `--dui-color-error` adapts invalid styling to the explicit light/dark themes.

Error text and borders use dark red on light surfaces and light red on dark surfaces. Destructive buttons pair this red with `--dui-color-on-error` (white in light mode, dark text in dark mode); dark-mode hover uses a lighter red with dark text. Custom error colors or surfaces should preserve at least 4.5:1 text contrast and 3:1 contrast for error borders.

Button defaults to `variant="raised"`. Use `variant="flat"` for square bordered controls with no default shadow or pressed movement. Flat pressed colors can be customized with `--dui-button-color-active` and `--dui-button-background-color-active`.

## FloatingActionLink and FloatingActionButton

```svelte
<FloatingActionLink href={resolvedHref} aria-label={addLabel} title={addLabel}>
	<Icon icon={AddIcon} />
</FloatingActionLink>
<FloatingActionButton aria-label={addLabel} onclick={addItem}>
	<Icon icon={AddIcon} />
</FloatingActionButton>
```

Use FloatingActionLink for navigation and FloatingActionButton for actions. Each accepts its native
HTML attributes and child content directly. The button defaults to `type="button"`; native
`disabled`, explicit `type="submit"`, and form attributes retain their normal behavior. Supply an
accessible name for icon-only controls using `aria-label` or `aria-labelledby`. Title is an optional
native attribute, and Icon is decorative by default. Visible child text can also provide a name.

Both components share a private presentation wrapper: a circular control aligned to the inline end
of its bottom-sticky container. Native class/style and callbacks apply to the actual anchor or button.
Consumers own icons, labels, resolved URLs, query parameters, and actions. Link activation and new-tab
behavior stay browser-native; labels for deliberate new-window navigation should describe that behavior.

The wrapper stays within the caller's scrolling/containing layout. The app owns surrounding spacing
and scroll/layout policy. Customize control size with `--dui-floating-action-size` (default `3.5rem`)
and content/icon size with `--dui-floating-action-icon-size` (default `--dui-font-size-xxl`). Colors,
border, shadow, and focus use the existing theme. Neither component owns application workflow state.

## SkipLink and SkipButton

```svelte
<SkipLink href="#main-content">{skipLabel}</SkipLink>
<main id="main-content" tabindex="-1">...</main>

<SkipButton aria-haspopup="dialog" aria-controls={dialogId} onclick={openTools}>
	{toolsLabel}
</SkipButton>
```

These controls stay available to assistive technology and keyboard navigation while visually
hidden. Focusing a control reveals it at the viewport's logical top/start corner; leaving it
hides it again. Place skip controls early in document order so keyboard users encounter them
before repeated navigation. Their fixed position does not reserve space in the page layout.

`SkipLink` requires `href` and preserves native anchor navigation. Supply an existing fragment
target; give non-interactive targets `tabindex="-1"` when they should receive focus.
`SkipButton` defaults to `type="button"` and retains native Enter/Space activation, disabled
state and explicit form attributes. It can open a caller-owned dialog without changing link
semantics. Both accept native attributes/events, class/style and child content on the actual
control. Callers own translated labels, targets, actions, dialog state and focus restoration.

## NumberKeypad

```svelte
<NumberKeypad
	label="Amount keypad"
	decimalLabel="Decimal separator"
	backspaceLabel="Delete last digit"
	nextLabel="Next"
	onkey={handleKey}
/>
```

`handleKey` receives a `NumberKeypadKey`: a digit string (`'0'`–`'9'`), `'decimal'`, `'backspace'`, or `'next'`. Import that type from `delightful-ui` when typing your handler. All keys are native `type="button"` controls; the keypad does not edit a value, submit a form, parse money, navigate, or listen for physical number keys.

Supply translated labels from the application. `decimalSeparator` changes the displayed character (default `.`) while its command remains `'decimal'`. `disabled` disables every key; `nextDisabled` disables Next independently. Native group attributes, class, and style pass through.

The three-column grid fills its container, with a full-width Next button. Keys use flat Buttons and responsive `--dui-number-keypad-key-aspect-ratio` (default `1`). Override it with `3 / 2` for rectangular keys. Other properties are `--dui-number-keypad-gap` (default `0.5rem`), `--dui-number-keypad-key-min-height` (default `64px`), and `--dui-number-keypad-font-size` (default `1.5rem`). Minimum height and content size take precedence when space is tight. The application owns width, screen placement, amount drafts, caret/focus management, and custom/device keyboard selection.

## InputText

Use a native name and optional default value for form submission without field state:

```svelte
<InputText
	label="Description"
	name="description"
	defaultValue="Groceries"
	required
/>
```

Native attributes and callbacks pass through. `bind:value` is optional. Use `label` for visible text, `id` for an explicit input ID, and a native datalist ID for `list`.

## InputNumber

```svelte
<InputNumber
	label="Quantity"
	name="quantity"
	defaultValue={1}
	min={0}
	step={1}
	required
/>
```

Native numeric constraints and callbacks pass through. Optional `bind:value` yields a number or undefined; FormData still yields strings. Use `min`, `max`, and `step` rather than character-length truncation.

## InputCurrency

```svelte
<InputCurrency
	label={amountLabel}
	currencyLabel="USD"
	name="amount"
	defaultValue="12.50"
	pattern={amountPattern}
	required
/>
```

Required `label` and `currencyLabel` are caller-owned strings. The currency label appears beside the native text input and is included in its accessible description. Caller-supplied `aria-describedby` IDs are preserved alongside the generated currency description ID, so FieldFeedback works normally. Use a short currency label such as USD, EUR or a translated abbreviation; no currency name or symbol is inferred.

Optional `bind:value`, `value` and `defaultValue` stay strings. Native FormData submits only the amount draft under `name`; the displayed currency label is not a submitted field. Native reset restores the default. `inputmode` defaults to decimal and `autocomplete` to off; native text attributes/events, disabled/read-only state, class and style pass through. `type` is fixed to text. Customize `--dui-input-currency-gap` (default `0.5rem`); input and field typography use the existing tokens.

InputCurrency does not parse, format, round, clamp, validate currencies, insert separators or convert money to floating-point/minor-unit values. Partial drafts and comma decimals remain exactly as entered. The application supplies locale/currency validation through `pattern` and its own validator, determines allowed decimal places and signs, handles integer conversion and owns keypad/device keyboard selection. There is no default money pattern or keypad workflow.

## InputDate

```svelte
<InputDate label="Date" name="date" defaultValue="2026-10-13" />
```

Values stay as date-only strings; the library performs no Date or timezone conversion. Native `min`, `max`, and `step` constraints pass through. `bind:value` is optional, and `defaultValue` supplies initial/reset text.

## InputAvatar

```svelte
<InputAvatar label="Avatar" name="avatar" removeLabel="Remove" bind:value />
```

A custom square image picker with a plus icon and cropped preview. The visible `label` is associated with the native file input. A persistent button below the square displays `uploadLabel` (default `Upload`) to choose an image and `removeLabel` (default `Remove`) after selection. Supply these props to customize or translate each label. The control keeps the same size in both states. Click the square to choose or replace an image. Supports a bindable `File | null`, native form submission, required validation, disabled state, and form reset. Customize the tile size with `--dui-avatar-size` (default `8rem`). Selecting a file does not upload it to a server.

## InputImage

```svelte
<InputImage label="Image" name="image" removeLabel="Remove image" bind:value />
```

Choose a single local image with a native file picker. Optional `bind:value` holds a `File` or `null` (the default); parent updates also update the native file input. The Browse control uses the flat button styling and shared `--dui-button-*` tokens, without an outer input border. Its native label follows the browser locale. The selected filename wraps onto multiple lines when needed. The selected image has a decorative preview and a removal button that returns focus to the input. Replacing, clearing, or destroying the component releases its preview URL. A failed preview leaves the selected file available for submission.

Supply translated `label` and `removeLabel` strings. Native attributes and callbacks pass through, including `name`, `id`, `required`, `disabled`, `capture`, and accessibility attributes. `accept` defaults to `image/*` and is a picker hint, not file validation. `type` is fixed to file and selection is single-file. Native form reset clears the image; disabled fields are omitted from submission. Read the selected file with `new FormData(form).get('image')`; use multipart encoding for native file uploads. The application owns uploading and validation.

## TagInput

```svelte
<TagInput
	label="Tags"
	name="tags"
	addLabel="Add tag"
	removeLabel={(tag) => `Remove ${tag}`}
	selectedTagsLabel="Selected tags"
	addedMessage={(tag) => `${tag} added`}
	removedMessage={(tag) => `${tag} removed`}
	duplicateMessage={(tag) => `${tag} is already added`}
	instructions="Press Enter to add a tag. Use Arrow keys to choose a suggestion."
	defaultValue={['Work']}
	suggestions={['Work', 'Personal', 'Recipes']}
/>
```

This custom component has no tag-input dependency. Enter or the Add button adds a trimmed tag; empty values and case-insensitive duplicates are rejected. Commas remain part of tag text. Duplicate drafts remain available for correction, and blur does not commit a draft. Optional `suggestions` appear in a native popover filtered by the draft, excluding tags already selected. Clicking a suggestion adds it immediately. Arrow keys select an option, Enter adds it, and Escape dismisses the list; typing again reopens it. Focus stays in the input. The list follows the input on scroll and resize, opens above it when space below is limited, and stays within the viewport. Browsers without the Popover API retain free-text entry and the Add button.

Optional `normalizeTag(tag)` supplies the comparison key used consistently for duplicate detection, suggestion deduplication, selected-suggestion exclusion and draft filtering. It receives trimmed text, including empty or incomplete drafts; use a pure function that accepts any string. The default is lowercase comparison. It never rewrites displayed tags, bound values, form submissions or announcement labels. Applications retain validation and persistence policies; custom Unicode normalization needs no additional DUI dependency.

Optional `bind:value` reads and updates a string array. `defaultValue` defaults to an empty array and supplies initial/reset tags; reset also clears the draft. Caller-supplied arrays are copied when edited. Supply translated `addLabel`, `removeLabel(tag)`, `selectedTagsLabel`, `addedMessage(tag)`, `removedMessage(tag)`, and `duplicateMessage(tag)` text. These labels and message callbacks are required. `id` and `placeholder` are optional.

Committed tags render as a named list. Additions and removals are announced through a polite status region; duplicate feedback is also visible and leaves the draft intact. Editing the draft or resetting clears feedback. After removal, focus moves to the next remove button, then the previous one if the last tag was removed, or to the input when no tags remain.

Optional `instructions` and `errorMessage` render visible text linked to the input. `errorMessage` marks the input invalid by default; an explicit `aria-invalid` takes precedence. `aria-describedby` accepts IDs for application-provided descriptions and is combined with internal help, error, and duplicate-feedback IDs. The application owns validation; no minimum tag count is enforced.

Chips and the entry controls share a wrapping row, with compact borderless remove buttons and 48px minimum heights. Customize `--dui-tag-gap`, `--dui-tag-entry-gap`, `--dui-tag-min-height`, `--dui-tag-color`, `--dui-tag-background-color`, and `--dui-tag-remove-background-color-hover`; input styling uses the shared input tokens.

Inside a form, each committed tag submits a separate field under `name`; read tags with `new FormData(form).getAll('tags')`. Draft text is excluded, and an empty array submits no fields. `disabled` prevents editing and submission; `readonly` prevents editing but submits existing tags. The component contains no nested form.

## FieldFeedback

```svelte
<InputText
	label={accountNameLabel}
	name="name"
	aria-describedby="account-name-feedback"
	aria-invalid={Boolean(errorMessage)}
/>
<FieldFeedback
	id="account-name-feedback"
	instructions={accountNameInstructions}
	{errorMessage}
/>
```

Required caller-owned `id` links feedback to any native control through `aria-describedby`. Optional `instructions` and `errorMessage` render plain translated text; when both are supplied, both remain visible. Error text uses the shared error color. Empty or omitted messages render no text, and the empty container stays in the DOM but occupies no layout space. Each field needs a unique feedback ID. Combine this ID with other description IDs when needed.

The application owns validation, issue mapping, `aria-invalid`, focus and announcements. FieldFeedback does not add a default live-region role, so it can describe a field without repeating aggregate form feedback. Native div attributes/callbacks, class and style pass through; supply a role explicitly only when the application needs it. Group the control and feedback with CSS grid/flex and `gap`. Customize `--dui-field-feedback-gap` (fallback `--dui-field-gap`, then `0.25rem`), `--dui-field-feedback-color` and `--dui-field-feedback-error-color`; typography uses the existing field tokens. Existing inputs need no new props to use this component.

## Select

```svelte
<Select label="Category" name="category" defaultValue="personal">
	<option value="personal">Personal</option>
	<option value="work">Work</option>
</Select>
```

Options and groups use native markup. Native attributes pass through; `bind:value` is optional. Use strings for single-select values/defaults, or string arrays with `multiple`. Styling shares the field/input tokens and keeps native browser appearance.

## Textarea

```svelte
<Textarea label="Notes" name="notes" defaultValue="First line" rows={4} />
```

Native multiline editing, attributes, and callbacks pass through. `bind:value` is optional; `defaultValue` supplies initial/reset text. Styling shares the field/input tokens, with vertical resizing by default through `--dui-textarea-resize`.

## Checkbox

```svelte
<Checkbox label="Receive updates" name="updates" value="yes" defaultChecked />
```

The native control submits its value only when checked and enabled. `bind:checked` is optional; `defaultChecked` supplies initial/reset state. The clickable label and native checkbox use green accent and explicit focus styling.

## RadioGroup and RadioItem

```svelte
<RadioGroup label="View" name="view" defaultValue="week">
	<RadioItem value="day">Day</RadioItem>
	<RadioItem value="week">Week</RadioItem>
	<RadioItem value="month" disabled>Month</RadioItem>
</RadioGroup>
```

Compose square-cornered radio buttons inspired by [Ant Design's radio buttons](https://ant.design/components/radio/) from two public components. `RadioGroup` supplies the native fieldset/legend, shared name, selection, validation, and reset behavior. `RadioItem` renders a labelled native radio with button styling; its children supply text or non-interactive rich content. Place items directly in the group, render them with an each block, or compose them through application components and layout wrappers. Items inherit the nearest group's state through Svelte context and must be rendered within a `RadioGroup`. Use unique string values within each group, and keep interactive controls outside item labels.

The default layout connects items and wraps on narrow screens. The selected item uses the theme accent and an inset underline. For a custom layout, place a grid or flex wrapper inside the group and set `--dui-radio-border-overlap: 0px` on it to give each item its own border. Item `class` and `style` apply to the label wrapper so apps can control placement; other native input attributes and callbacks pass through, including `id`, `aria-label`, and `aria-describedby`.

Group `bind:value` is optional; `defaultValue` supplies the initial selection and the selection restored by form reset. An explicit `value` takes precedence over `defaultValue`. Without either, the group starts unselected; assigning `undefined` clears a bound selection. Native keyboard navigation, focus, validation, and form submission are preserved. `required` uses native radio-group validation. Group `disabled` disables every item; item `disabled` disables just that choice. Only an enabled selection is submitted. Supply group `name` for a stable form-data key; omitted names are generated per instance so groups remain independent. Group `form` associates every item with an external form. Native fieldset attributes, class, style, and events pass through; group and item `onchange` callbacks receive the native input event after selection updates.

Customize `--dui-radio-background-color`, `--dui-radio-color`, `--dui-radio-border-color`, `--dui-radio-selected-background-color`, `--dui-radio-selected-color`, `--dui-radio-focus-color`, `--dui-radio-padding`, `--dui-radio-min-height` (44px), and `--dui-radio-disabled-opacity` (0.5). Typography, label spacing, and border width use shared field/input and theme tokens. `RadioItem` owns the item tokens; `RadioGroup` owns `--dui-radio-border-overlap` (defaults to the shared border width).

## Typography and Button styling

Typography resolves size props through a shared typed font-token lookup and uses one scoped base rule per component. Existing `--dui-heading-font-size` / `--dui-text-font-size` overrides and native inline styles remain supported; omitted alignment inherits from the parent, including nested typography. `data-size` and `data-align` remain available without driving variant selectors.

Button variants configure private color values consumed by shared hover/active rules. Existing public button tokens remain the customization API. Native disabled state (including disabled fieldsets), `aria-disabled`, flat/raised behavior, focus, reduced motion and forced colors remain separate interaction concerns. Private `--_dui-*` variables are implementation details.

## Details

Ordinary children use the default padded content with its existing border/theme tokens. Supply a `content` snippet to replace that presentation with consumer-owned markup and scoped CSS; when supplied, it takes precedence over children. Absolute mode keeps a library-owned positioning, border and overflow frame around either presentation. The existing `caret(open)` snippet lets consumers own decorative caret markup and sizing.

```svelte
<Details summary="Filters">
	{#snippet content()}
		<div class="filters"><!-- consumer-owned layout --></div>
	{/snippet}
</Details>
```

```svelte
<Details summary="Filters" position="absolute" align="end">
	<form><!-- native controls --></form>
</Details>
```

Summary text is not selectable. The disclosure icon defaults to the left; use `caretPosition="right"` to place it on the right. Supply a decorative `caret` snippet to replace the icon; it receives the current open state:

```svelte
<Details summary="Options" caretPosition="right">
	{#snippet caret(open)}
		<span>{open ? '−' : '+'}</span>
	{/snippet}
	<p>Additional information.</p>
</Details>
```

Inline is the default. Absolute mode anchors a bounded panel to its summary and supports outside-pointer and Escape dismissal. Use native attributes/callbacks and optional `bind:open`.

## Popover

```svelte
<Button popovertarget="amount-info">About amounts</Button>
<Popover id="amount-info">
	<p>Enter the total amount, including tax.</p>
</Popover>
```

Supply a unique `id` and caller-owned, accessibly named trigger. Rich children and native div attributes/callbacks pass through, including `onbeforetoggle` and `ontoggle`. Popover always uses native auto behavior: the trigger toggles it, outside clicks and Escape dismiss it, and opening another unrelated auto popover closes it. There is no `bind:open`, modal focus trap, or default tooltip/dialog role. Callers provide translated content, headings, and optional close buttons using `popovertargetaction="hide"`.

CSS anchor positioning places the panel below the invoking button with a 4px gap and alternative placements when space is limited. Browsers without CSS anchor positioning retain centered native placement. Native Popover API support is required; no polyfill is included. The panel defaults to 24rem, bounded by the viewport with scrollable overflow. Customize `--dui-popover-width`, `--dui-popover-gap`, `--dui-popover-padding`, `--dui-popover-color`, `--dui-popover-background-color`, `--dui-popover-border-width`, `--dui-popover-border-color`, and `--dui-popover-shadow`; shared theme tokens supply defaults.

## Dialog

```svelte
<Button onclick={() => (dialogOpen = true)}>Edit item</Button>
<Dialog heading="Edit item" bind:open={dialogOpen}>
	<form method="dialog">
		<Button type="submit" value="cancel" formnovalidate>Cancel</Button>
	</form>
</Dialog>
```

Initialize dialogOpen as a Svelte boolean state. Dialog uses native modal behavior and callbacks; triggers and close controls belong to the caller. Required headings accept caller-translated strings or snippets. Locale objects and UIProvider have been removed.

## LoadingSpinner

```svelte
<LoadingSpinner text="Saving changes" />
```

Screen-reader text renders only when a nonempty `text` is supplied; there is no default message. Supply translated text for standalone status spinners. For decorative use alongside an existing message, omit `text` and set `role="presentation"` and `aria-hidden="true"` (or hide its wrapper). Native div attributes and callbacks pass through. Customize `--dui-loading-spinner-size`, `--dui-loading-spinner-color`, and `--dui-loading-spinner-border-width`; defaults retain the 80px current-color ripple. Reduced-motion mode shows one static ring.

## LoadingScreen

Supply an optional `feedback` snippet to replace the default StatusMessage inside the centering layout. Provide either `text` for the default or `feedback` for custom markup; the snippet takes precedence if both are supplied. Custom feedback owns its status/alert announcements, so the layout adds no extra live region.

```svelte
<LoadingScreen>
	{#snippet feedback()}
		<StatusMessage variant="error" text={failureMessage} />
		<Button onclick={retry}>{retryLabel}</Button>
	{/snippet}
</LoadingScreen>
```

Center a single translated startup message horizontally and vertically within a full viewport. Keep the page's main landmark in the caller.

```svelte
<main>
	<LoadingScreen text={loadingMessage} />
</main>
```

Use `variant="error"` for a failed startup without a spinner. The message uses StatusMessage's status/alert semantics; the spinner is decorative. Native div attributes, class and style are forwarded. Set `--dui-loading-screen-min-height` for a contained area; content grows naturally for long text and small viewports. Width and internal padding have corresponding `--dui-loading-screen-*` tokens. It does not add a main landmark, focus trap, autofocus, overlay or state management.

## LoadingContent

```svelte
<LoadingContent loading={pending} text={loadingMessage}>
	<InputText label={draftLabel} bind:value={draft} />
	<Button type="button" onclick={save}>{saveLabel}</Button>
</LoadingContent>
```

Keeps child content mounted while `loading` is true (the default), preserving input state and
content layout. Pending content is dimmed, inert, and hidden from the accessibility tree; the
wrapper exposes `aria-busy`. A LoadingScreen shares a grid area with the retained content. When `loading` becomes false, the overlay is removed and the same controls become
usable. Focus is not moved or restored automatically; the caller owns focus when starting work
from inside the region. The region accommodates both retained content and feedback, so reserve sufficient space for
longer loading messages when needed.

Supply translated `text` and optionally `variant="error"`. The component does not fetch data,
interpret query state, retry, or provide fallback strings. Avoid adding a live role to the wrapper:
the overlay already supplies a status (or alert for errors). Without children, it renders a
standalone LoadingScreen regardless of `loading`, preserving the startup/error composition.
Native div attributes, callbacks, class, and style pass to the retained-content wrapper or the
standalone screen. LoadingScreen CSS properties customize the standalone presentation.

## StatusMessage

See the [Finance-driven component specification](docs/finance-component-spec.md) for requirements and proposed follow-up components.

```svelte
<StatusMessage variant="loading" text={loadingMessage} />
<StatusMessage variant="success" text={savedMessage} />
<StatusMessage variant="error" text={saveError} />
```

Provide caller-owned `text` or an optional `message` snippet for rich inline content. The snippet replaces the visible text while StatusMessage keeps its live-region root and decorative indicator; do not add another live region inside the snippet. If both are supplied, `message` takes precedence. `variant` defaults to `info`; `loading` adds a compact decorative LoadingSpinner, while `success` and `info` show text alone. Errors use `role="alert"` and the shared error color; other variants use `role="status"`. The spinner is excluded from the accessibility tree, leaving one live region. Native div attributes and callbacks, class, and style pass through. Override `role` or `aria-live` when the application supplies announcement behavior; avoid nesting inside another live region. For announcements of updates, keep the component mounted and update its text/variant rather than relying on initially rendered status text being announced.

The application owns visibility, loading/save state, translations, retry actions, and error mapping. The component accepts plain text and adds no dismissal, timer, form logic, or generic fallback messages. Spacing uses `gap`, and long text wraps. Customize `--dui-status-message-gap`, `--dui-status-message-color`, `--dui-status-message-error-color`, `--dui-status-message-spinner-size` (default `1.5rem`), and `--dui-status-message-spinner-border-width` (default `2px`). Loading animation and reduced-motion behavior come from LoadingSpinner.

```svelte
<StatusMessage variant="error">
	{#snippet message()}
		{failureMessage} <a href={helpHref}>{helpLabel}</a>
	{/snippet}
</StatusMessage>
```

## ScreenReaderText

```svelte
<Button>Save <ScreenReaderText>changes to this item</ScreenReaderText></Button>
```

Children supply visually hidden supplementary text. Native span attributes pass through, including `id` for accessible description references. Keep interactive controls outside this component.

## SwipeActions

```svelte
<ul>
	<li>
		<SwipeActions
			{actionsLabel}
			leftActions={[
				{ id: 'archive', label: archiveLabel },
				{
					id: 'delete',
					label: deleteLabel,
					variant: 'destructive',
					dismissOnSwipe: true
				}
			]}
			rightActions={[{ id: 'favorite', label: favoriteLabel }]}
			onactionchosen={(choice) => handleAction(item.id, choice)}
		>
			<a href={item.href}>{item.title}</a>
		</SwipeActions>
	</li>
</ul>
```

A reusable action drawer beneath caller-owned content. Swiping right reveals
`leftActions`; swiping left reveals `rightActions`. Sides describe the physical
location of the drawer, including in RTL layouts. Order actions from the first
stage to the final stage, with unique IDs within each side. Each action accepts
`id`, `label`, optional `disabled` and `dismissOnSwipe`, and the existing Button `variant` values.

A short horizontal drag reveals native action buttons when released. Dragging
35% of the row width arms the first enabled action; intermediate enabled actions
are spaced evenly up to the final action at 90%. With one enabled action, it is
reserved for the 90% full swipe. Releasing an armed swipe chooses that action;
moving back reduces or cancels the armed stage. Reopening a drawer requires a
deliberate additional drag before arming. Action labels keep the same wrapping
and text styling as their backgrounds expand. Once an action is armed, the other
actions fade to dimmed while it stays at full brightness. Retreating below the threshold
restores them; the cue also stays visible during a committed exit. Selection
changes only opacity, so label positions and wrapping remain unchanged.
A gesture never chooses an action until release. Disabled actions remain visible as disabled buttons and are skipped by
the progressive swipe stages.

Set `dismissOnSwipe: true` on the final enabled action to finish a full swipe off
the row instead of returning it to the closed position. On release, the final
action's background expands across the row and covers the other buttons while
the content slides away. Its label retains its width and text styling. It works independently
of `variant`: archive can dismiss without destructive styling, while trash can
use both. Releasing at the 90% threshold commits the exit; retreating or
cancelling before release still backs out. The row becomes inert during the exit
and hidden when it finishes. `onactionchosen` fires once after the native CSS
exit and fill transitions complete, so the app can remove its list item without interrupting
the animation. With reduced motion or zero duration, completion is immediate.
Choosing a button or an earlier action retains the ordinary callback behavior.

To restore a retained row after an undo or failed operation, bind the component
instance (`bind:this={swipeRow}`) and call `swipeRow.reset()`. Resetting during an
exit cancels its pending notification. The component does not delete data or
remove the consuming app's `li`.

`onactionchosen` is a typed Svelte 5 callback receiving `{ id, side, source }`,
where `side` is `left` or `right` and `source` is `swipe` or `button`. The component
closes after an ordinary choice, or exits for an opted-in final full swipe. The consuming app owns archiving, deleting, confirmations,
async work, persistence, and item removal. The callback does not receive a
CustomEvent or `.detail`. The package also exports the `SwipeAction`,
`SwipeActionChosen`, and `SwipeSide` types.

Native Pointer Events handle touch, mouse and pen; CSS `touch-action: pan-y
pinch-zoom` preserves vertical scrolling and pinch zoom. Gesture tracking locks
only after horizontal intent. Cancellation, lost capture, window blur, resizing,
and action/disabled changes back out without choosing. Ordinary taps and keyboard
link activation retain their native behavior; a completed horizontal drag
suppresses the resulting click. Starts on buttons, inputs, selects, textareas,
summaries, editable content, or descendants marked `data-swipe-ignore` do not start
a swipe. Browser/OS edge-navigation gestures remain browser-owned.

Actions stay underneath the row in the same fixed-height container. The row
slides aside to expose solid, edge-to-edge action surfaces; it has no visible
menu trigger or separate expanded panel. `actionsLabel` supplies the group's
accessible name. For keyboard access, focus the row link and press ArrowRight to
reveal the left drawer or ArrowLeft to reveal the right drawer. These keys slide
the same row and focus its first enabled action. Escape closes it and returns
focus to the row. For content without a focusable child, give SwipeActions
`tabindex={0}`. Native action buttons stay inert and hidden from the accessibility
tree until their side is revealed. `disabled` cancels the interaction while
leaving caller-owned content available.

The root is a `div`: place it inside the consuming app's `li` when building a
list. Supply the row's anchor/content as children; do not wrap SwipeActions in a
link or nest the `li` produced by LinkedListRow inside it. Native root attributes,
class and style pass through. Customize `--dui-swipe-background-color` (defaults to
the theme background), `--dui-swipe-action-width` (5.5rem) and
`--dui-swipe-duration` (180ms). Button variants and focus styles use the existing
theme; corners remain square, and reduced-motion preferences disable settling
and dimming animations. XState is the only added runtime dependency; there is no gesture
library or Svelte adapter dependency.

Interaction ownership is a private XState machine: closed/open rest,
pointer tracking, yielding to vertical scrolling, revealing/armed drag, and a
single chosen-action emission. The Svelte wrapper owns native event listeners,
pointer capture, measurement, focus, and actor teardown. Storybook includes both
directions, three progressive actions, full-swipe dismissal with reset, one-sided actions, disabled actions,
disabling, and a scrollable mobile list.

## LinkedListRow

```svelte
<ul>
	<LinkedListRow href={resolvedHref} label={destinationLabel}>
		<Text as="span"><strong>{title}</strong></Text>
		<Text as="span">{description}</Text>
		{#snippet trailing()}<Text as="span">{formattedMetadata}</Text>{/snippet}
	</LinkedListRow>
</ul>
```

Renders a native `li` containing one anchor covering the row, with main content, optional trailing
metadata, and a decorative chevron. Use it within `ul` or `ol`. The supplied translated `label`
provides the link's accessible name; include the visible title in that name. Children and trailing
content must be non-interactive: do not put other links, buttons, or form controls inside the row.
The row has one native tab stop and retains normal browser link activation and context-menu behavior.

The caller owns URL resolution, routing, query parameters, labels, formatting, and domain state.
Native anchor attributes and callbacks (including class/style) apply to the anchor. A supplied
`target` or `download` retains native behavior; labels for deliberate new-window navigation should
communicate that behavior. The component does not synthesize clicks or manage application state.

Customize `--dui-linked-list-row-gap`, `--dui-linked-list-row-padding`, and
`--dui-linked-list-row-font-size`. Colors and focus treatment use the existing DUI theme.

## Table

```svelte
<Table caption={accountsCaption}>
	<thead
		><tr
			><th scope="col">{accountLabel}</th><th scope="col">{currencyLabel}</th
			></tr
		></thead
	>
	<tbody>
		{#each accounts as account (account.id)}
			<tr><th scope="row">{account.name}</th><td>{account.currency}</td></tr>
		{/each}
	</tbody>
</Table>
```

Required `caption` is caller-translated visible text and names both the native table and its scrolling region. Supply native `thead`, `tbody`, optional `tfoot`, header scopes and row markup as children; Table supplies the caption, so do not add a second one. Native table attributes/events, class and style pass through to the table. `hidden` also hides the surrounding region. The focusable overflow region supports native keyboard scrolling on narrow screens without changing table semantics or rendering stacked cards.

The component owns presentation only. Callers own rows, formatting, numeric alignment, row-action labels/handlers, sorting and empty/loading states. The header is black with white text; `data-dui-theme="dark"` reverses it to white with black text. Thin lines separate body rows and underline the header. Collapsed native borders keep the header band and separators continuous. Cells use internal padding (default `0.5rem` on each axis); layout spacing between action buttons still uses flex/grid `gap`.

Customize `--dui-table-cell-padding-block`, `--dui-table-cell-padding-inline`, `--dui-table-header-background-color`, `--dui-table-header-color`, `--dui-table-row-border-width` (default `1px`), `--dui-table-row-border-color`, `--dui-table-min-width` (default `100%`) and `--dui-table-color`. Set a larger minimum width when columns should scroll rather than compress. Header overrides take precedence over theme defaults.

## Navigation

```svelte
<Navigation label={navigationLabel}>
	<li>
		<a href="/" aria-current={pathname === '/' ? 'page' : undefined}
			>{overviewLabel}</a
		>
	</li>
	<li>
		<a
			href="/accounts"
			aria-current={pathname === '/accounts' ? 'page' : undefined}
			>{accountsLabel}</a
		>
	</li>
</Navigation>
```

Required `label` names the native nav landmark. Children supply native `li` elements and links; Navigation owns the surrounding list. `orientation` defaults to `vertical`; set `orientation="horizontal"` for a row that wraps when space is limited. Set `aria-current="page"` on the current link in the application. It receives font-weight emphasis without changing native link behavior. Native nav attributes/events, class and style pass through. Give multiple landmarks distinct translated labels. A list item can contain a native `button popovertarget="…"` and Popover for a dropdown. Navigation styles that trigger as a borderless, underlined link, matching the Clipper reference. Supply native links inside; close the popover when a link is selected. Popover provides native outside-click/Escape dismissal, top-layer rendering and CSS anchor placement/fallbacks where supported. Browsers without CSS anchor positioning retain centered placement. Keep any visible disclosure arrow decorative and synchronize caller-owned `aria-expanded` from native toggle events.

Routing, active-route matching, permissions, link grouping, workspace selection and collapsed/mobile shell behavior remain caller-owned. Navigation adds no menu roles, arrow-key handling, route interception or data model. Link spacing uses `gap`; list padding/margins are reset. Links have a 44px minimum height and visible focus. Customize `--dui-navigation-gap`, `--dui-navigation-link-min-height` and `--dui-navigation-current-font-weight`; colors inherit the existing link/theme styles.

## Stepper

Pass `steps` and `currentStep`; plain `step.label` remains the default visible label. An optional `stepLabel(step)` snippet replaces only the visible inline label. Stepper retains the ordered list, decorative numbering, `aria-current` and translated completed/upcoming announcements. Keep those announcements out of the custom snippet to avoid duplication.

```svelte
<Stepper
	{steps}
	{currentStep}
	label={progressLabel}
	{completedLabel}
	{upcomingLabel}
>
	{#snippet stepLabel(step)}<strong>{step.label}</strong>{/snippet}
</Stepper>
```

## Drawer

Use `closeControl(close, label)` to replace the default close button. Render an accessibly named native control and invoke the supplied callback; `label` is the translated `closeLabel`. Drawer retains panel visibility, scoped Escape and focus restoration. `showCloseButton={false}` hides the custom control too. Default close-button sizing applies only to the default button, leaving custom markup locally styleable.

```svelte
<Drawer heading={menuHeading} closeLabel={closeMenuLabel} bind:open={menuOpen}>
	{#snippet closeControl(close, label)}
		<button type="button" onclick={close}>{label}</button>
	{/snippet}
	<!-- navigation content -->
</Drawer>
```

Set `--dui-drawer-panel-border-inline-end` to a CSS border value (for example, `2px solid currentColor`) to add a separator on the panel’s logical inline end. It defaults to `0`, preserving the borderless panel. Set it through the Drawer’s native `style` attribute or an inherited custom property; consumers do not need to select the internal panel element.

```svelte
<Button onclick={() => (menuOpen = true)}>{openMenuLabel}</Button>
<Drawer heading={menuHeading} closeLabel={closeMenuLabel} bind:open={menuOpen}>
	<Navigation label={navigationLabel}>
		<li>
			<a href="/accounts" onclick={() => (menuOpen = false)}>{accountsLabel}</a>
		</li>
	</Navigation>
</Drawer>
```

`mode` defaults to `overlay`, composing native Dialog into a full-height side panel. Required `heading` and `closeLabel` are caller-owned; heading also accepts a snippet. `side` defaults to `left`, with `right` available. Optional `bind:open` controls visibility. The compact × close button uses the required translated closeLabel as its accessible name. Set `headingHidden` to keep the heading available to screen readers without showing it. The close button and Escape dismiss it. Overlay mode keeps keyboard focus inside, makes the background inert and restores focus through native dialog behavior. `closedby` defaults to `any` for browser-supported outside-click dismissal.

Set `mode="inline"` for a collapsible sidebar in normal page layout. It renders a labelled `aside`, with no dialog/modal role, backdrop, background inertness or focus trap. Put it beside the page content in a flex/grid container to reserve actual layout space. Keep DOM order consistent with visual order: place a right sidebar after the content rather than reordering it with CSS. The application chooses responsive breakpoints; the stories stack content on narrow screens.

For inline mode, give the toggle `aria-controls` referencing the drawer's `id` and `aria-expanded={menuOpen}`. Opening leaves focus on the toggle. Closing while focus is inside restores focus before hiding the panel; optional `triggerId` identifies a persistent return target, including initially open or programmatically opened sidebars. Otherwise the element focused when opening is used. Escape dismisses inline mode only when focus is inside. Outside clicks do not close it. Closed content is hidden and inert immediately, including during exit animation. Changing modes closes the drawer to avoid carrying focus across incompatible interaction contexts.

Native attributes/events, class and style pass through to the active container; dialog-only `closedby` applies only in overlay mode. Triggers, Navigation and link/route-selection behavior remain caller-owned. For an inline sidebar, links need not collapse it. Use gap for sibling layout spacing; internal panel padding uses Dialog tokens.

Overlay mode slides/fades; inline mode animates its reserved width. Both respect reduced motion, and retain the inert visual panel until exit motion finishes. Inline focus restoration waits for caller-hidden triggers to become visible. Without motion support, visibility changes immediately. Both variants fill the viewport height by default; inline placement sticks to the top during page scrolling. The body scrolls independently beneath the close control. Set `--dui-drawer-height` for a contained layout. Customize `--dui-drawer-width` (default `24rem`), `--dui-drawer-gap` and `--dui-drawer-duration` (default `200ms`). Colors, borders and padding use Dialog tokens; backdrop tokens apply only to overlay mode. No touch/swipe gesture or automatic responsive breakpoint is included.

See the [accessibility specification](docs/finance-component-spec.md#drawer--implemented-awaiting-review) for each mode's behavior and pending verification.

## Storybook

Storybook uses the latest stable compatible toolchain verified for this migration: Storybook 10.6.2 and Svelte CSF addon 5.1.5. It runs independently of the SvelteKit demo using the Svelte/Vite framework. Stories cover all twenty public components with the optional theme applied.

```sh
pnpm storybook
pnpm build-storybook
```

Development servers bind to `0.0.0.0` by default. Storybook uses http://127.0.0.1:6006 with a strict port and is also accessible at `http://<your-LAN-IP>:6006`. The static build writes `storybook-static`, which is ignored by git and excluded from the published library. Stories and configuration participate in static checking and linting.

After reviewing implementation, `pnpm test:storybook` builds a test-only Storybook and runs Select, Textarea, Checkbox, and InputDate Chromium scenarios on temporary preview port 6007. It includes binding fixtures without adding them to the normal Storybook.

To test SwipeActions against an already-running development server, use `DUI_STORYBOOK_URL=http://127.0.0.1:6006 pnpm exec playwright test --config playwright.storybook.config.js tests/storybook/swipe-actions.spec.js`. Coverage includes desktop Chromium, mobile Chromium and mobile WebKit contexts. Native touch swipes, cancellation and scrolling use Chromium CDP; WebKit covers pointer gestures and native taps. These checks do not replace physical-device testing.

## Deployment and CI

Netlify builds the public Storybook using `pnpm build-storybook` and publishes
`storybook-static`. The root `netlify.toml` pins Node.js 24 and pnpm 10.22.0;
production and deploy previews use the same configuration. Link the Netlify site
to this repository with its base directory left at the repository root.

The GitHub `CI` workflow runs on pull requests and supports manual runs. It installs
lockfile-pinned dependencies, checks Svelte/TypeScript, runs unit tests, builds the
demo/library, runs app Chromium and Storybook Chromium/mobile WebKit tests, and
builds the public Storybook. Browser tests use one worker and temporary local
preview servers. Browser reports and failure artifacts are retained for 14 days.
No Netlify credentials are needed in GitHub: Netlify handles deployments through
its repository integration. Branch protection can require the
`Unit and browser tests` check after the workflow has run.

## Packaging and publishing

Import components from `delightful-ui`: Text, Heading, Button, FloatingActionLink, FloatingActionButton, NumberKeypad, Details, Dialog, Popover, InputText, InputNumber, InputCurrency, InputDate, InputImage, InputAvatar, FieldFeedback, Select, Textarea, Checkbox, RadioGroup, RadioItem, TagInput, LoadingSpinner, StatusMessage, LoadingScreen, LoadingContent, Table, LinkedListRow, SwipeActions, Navigation, Drawer, and ScreenReaderText.

The root package exports `dist/index.js` and `dist/index.d.ts`. Internal library aliases are rewritten by Svelte's package tooling. Consumers require Svelte 5.57.2 or newer within Svelte 5.

To prepare a local archive after building:

```sh
pnpm pack
```

Publishing requires explicit authorization. Run `pnpm publish` from the repository root when authorized; the package's `files` field includes `dist`. Do not publish the obsolete `package` directory.

Use https://www.conventionalcommits.org/en/v1.0.0/ for PR titles.
