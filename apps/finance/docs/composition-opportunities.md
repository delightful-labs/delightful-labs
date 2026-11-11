# Composition audit

Prefer a small snippet that replaces presentation over public properties for
arbitrary display/grid/alignment. Preserve semantic elements, accessibility and
positioning behavior in the owning component. Keep theme tokens for colors,
borders and ordinary spacing. Avoid adding replacement APIs without a consumer.

## Implemented: DUI Details / Finance disclosures

Details defaults to its existing padded body. Its optional `content` snippet
replaces that body; absolute mode retains the positioning/overflow frame. Finance
owns its sidebar grid and uses the existing `caret(open)` snippet for its sized
transaction caret. Four layout-specific tokens are removed. Existing children,
summary and native disclosure behavior remain supported.

## Implemented: DUI feedback and controls (review pending)

| Component     | Replacement snippet          | Default and retained ownership                                                                                                                                  |
| ------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LoadingScreen | `feedback()`                 | Defaults to StatusMessage; retains the centering frame. Custom feedback owns its live announcements.                                                            |
| StatusMessage | `message()`                  | Defaults to plain text; retains the live-region root and decorative indicator. Custom content is inline markup.                                                 |
| Stepper       | `stepLabel(step)`            | Defaults to step.label; retains ordered-list semantics, numbering, aria-current and translated status announcements.                                            |
| Drawer        | `closeControl(close, label)` | Defaults to the existing button; retains visibility, Escape and focus restoration. Consumer supplies an accessible control using the callback/translated label. |

These APIs were explicitly requested following the audit. Finance's existing call
sites continue to use their defaults; no speculative Finance APIs were added.

## Existing composition boundaries to keep

- Finance AppLink already resolves destinations through a render snippet; consumers
  can own native anchors without another API.
- FormContent already accepts fields/controls/feedback, and SplitRow accepts content
  and trailing markup. Prefer those APIs over additional layout properties.
- DUI Button, TopNavigation, Navigation, Table and Dialog already accept children;
  Dialog/Drawer headings and Details summaries already accept snippets. Reuse them
  before introducing replacement roots.
- Keep native form controls, table semantics, live regions, modal dialogs and
  positioning frames library-owned. Replacing those roots would require consumers
  to reproduce behavior and accessibility rather than just presentation.

The library README documents each fallback/replacement contract. Validate behavior
and accessibility after implementation review; add no permanent appearance tests.
