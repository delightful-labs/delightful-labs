# Reusable Interaction Discovery and DUI Recommendations

**Status**: Source-based discovery for review. No app was launched, no usability/a11y result is
claimed, and no component, dependency, test, or consumer migration is implemented here.
This addresses FR-015 at the discovery/recommendation level, not runtime UI acceptance.

## Evidence and Provenance

- DXOS/Composer: source snapshot `0d811677577e239ae9a0f8b6ab035cb9c986835b` previously downloaded.
- Jazz/Band Book example: source snapshot `45905c42946a07465ca33ec8a84e4180771aff74`.
- Local DUI: package 0.0.24, clean checkout `834f8d22170c5c22ca8258bc2876af76112cc095`.
- Finance reference UI: checkout HEAD `6e9c39e66b3f65b1a46b854f243837ac68956542`; read existing
  recovery/query components, without changing the consumer. Its wider worktree is not an artifact
  of this discovery task.

Documentation corroborates backend-native flows: [Jazz recovery and passkey backup](https://jazz.tools/docs/auth/local-first-auth)
and [DXOS device invitation/authentication](https://dxos.org/docs/halo/typescript/).
The source snapshots below provide the concrete interaction evidence; framework code, visual
styles, native API assumptions, and example accessibility behavior are not copied wholesale.

| Observed interaction in source                                                                                                        | Concrete evidence                                                                                                                                                                                              | Foundation implication                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Finance reveals a phrase only after an explicit action, then presents warning, selectable text, saved confirmation, and close         | [AccountRecovery.svelte](../../../delightful-finances/src/lib/components/AccountRecovery.svelte) uses DUI Dialog/Textarea/Checkbox/Button; parent clears phrase on hide                                        | Build a recovery composition, not a generic DUI account module; always allow dismissal and clear ephemeral values                    |
| Composer recovery displays a code, warnings, saved confirmation, and clipboard action                                                 | [RecoveryCodeDialog](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/plugins/plugin-client/src/containers/RecoveryCodeDialog/RecoveryCodeDialog.tsx#L20)                   | Share reveal/backup presentation where applicable, but allow backend-native recovery methods; do not assume every method is a phrase |
| Composer device flow moves from explicit invitation creation to QR/link, authentication code, and terminal/retry states               | [DevicesContainer](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/plugins/plugin-client/src/containers/DevicesContainer/DevicesContainer.tsx#L69)                         | Pairing is a stateful foundation workflow; optional QR and clipboard are generic presentation opportunities                          |
| Device invitation cancellation explicitly calls flow.cancel before dropping local state                                               | [Cancellation handler](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/plugins/plugin-client/src/containers/DevicesContainer/DevicesContainer.tsx#L97)                     | Dismissal must release native invitation resources; hiding a dialog alone is not cancellation                                        |
| Composer JoinPanel distinguishes new identity, recovery, identity invitation, space invitation, authentication, and retry/reset paths | [JoinPanel](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/sdk/shell/src/panels/JoinPanel/JoinPanel.tsx#L30)                                                              | Use explicit workflow modes and step focus; avoid a universal one-form login screen or copying Composer's app-wide reset flow        |
| A workspace invitation card derives joined state from live spaces, changing Join to Open                                              | [SpaceInvitationContainer](https://github.com/dxos/dxos/blob/0d811677577e239ae9a0f8b6ab035cb9c986835b/packages/plugins/plugin-client/src/containers/SpaceInvitationContainer/SpaceInvitationContainer.tsx#L24) | Foundation reports pending/accepted/expired/failed state from native results; consumer owns navigation after acceptance              |
| Band Book distinguishes inherited/direct grants and provides role selection, invite links, copying, and revoke controls               | [ShareDialog](https://github.com/garden-co/jazz/blob/45905c42946a07465ca33ec8a84e4180771aff74/examples/band-book/apps/nextjs-betterauth/src/components/ShareDialog.tsx#L33)                                    | Reuse access-summary and invitation interaction patterns; page inheritance and page-specific grants stay in the app domain           |
| Finance query wrapper shows loading/error feedback around consumer content                                                            | [QueryContent.svelte](../../../delightful-finances/src/lib/components/QueryContent.svelte)                                                                                                                     | Share feedback presentation and explicit ready/empty/error snapshots without adopting backend subscriptions in presentation          |

The Composer recovery source contains a TODO for a cancel button and hover-only clipboard styling.
Those are not recommended behaviors to reproduce. Likewise, reference test attributes or debug
logging of invitation material are not part of a foundation API or telemetry design. Source review
supports a flow pattern, not approval of every implementation detail.

## Existing DUI Primitives

The current [DUI exports](../../../delightful-ui/src/lib/index.js) already include Dialog,
Popover, Button, InputText, Textarea, Select, Checkbox, FieldFeedback, StatusMessage,
LoadingSpinner, and ScreenReaderText. Their responsibilities fit the initial compositions:

| Need                                                       | Existing primitive / evidence                                                                                                                                                    | Recommendation                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Modal heading, native dialog behavior, close/cancel events | [Dialog](../../../delightful-ui/src/lib/Components/Dialog.svelte); existing dialog browser checks cover focus return, Escape, validation, and removal                            | Reuse; future composition validation must still cover step changes and secret cleanup        |
| Small nonmodal contextual surface                          | [Popover](../../../delightful-ui/src/lib/Components/Popover.svelte) wraps native auto popover                                                                                    | Reuse for lightweight choices; keep long recovery/pairing forms in a dialog or embedded view |
| Loading/success/error announcement with decorative spinner | [StatusMessage](../../../delightful-ui/src/lib/Components/StatusMessage.svelte) sets status/alert and hides spinner from accessibility tree                                      | Reuse one message region; do not nest another live spinner announcement                      |
| Labelled text/phrase/code entry and field guidance         | [InputText](../../../delightful-ui/src/lib/Components/Inputs/InputText.svelte), Textarea, [FieldFeedback](../../../delightful-ui/src/lib/Components/Inputs/FieldFeedback.svelte) | Use native labelled fields, described-by/error wiring, and supplied validation messages      |
| Saved confirmation and membership role choice              | Checkbox and Select                                                                                                                                                              | Compose from existing controls; keep role mapping/backend guarantees in the foundation       |

Existing DUI test files were read, not run. Their presence is evidence of intended native behavior,
not a passing result from this review. Finance's QueryContent comment calling StatusMessage a
future primitive is stale relative to this DUI checkout; no new loading/status primitive is needed.

## Recommended Missing Generic Presentation

Names in this table are proposals, not available DUI imports or authorized implementations.
No new generic primitive is necessary to start the text-based v1 composition design.

| Proposed primitive     | Evidence and reusable behavior                                                                                                                                                                                                                                      | Ownership / priority                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Clipboard-copy control | Recovery and invitation sharing both use copy actions in Composer; Band Book separately implements clipboard/success state. A generic control could provide explicit activation, accessible text label, pending/copied/failure state, and caller-localized messages | Future DUI enhancement, not a foundation v1 requirement. Current Button + foundation integration + StatusMessage can meet v1 needs         |
| QR presentation        | Composer device invitations show QR alongside a copyable link and authentication steps. A generic QR renderer could accept an ephemeral value, accessible label, and equivalent textual/manual route                                                                | Future DUI enhancement, not a foundation v1 requirement. Dependency/encoding choice requires separate review; never the only pairing route |

Clipboard behavior must report actual success/failure, stay keyboard-visible, avoid automatically
copying secrets, and never promise clearing the user's system clipboard on dialog dismissal.
The caller owns which value is exposed and when; the generic control has no account or database
knowledge. Clipboard availability/failure must leave a manual copy path.

QR presentation must never be the only way to pair devices. Code validity, expiration,
authentication challenges, and pairing completion remain foundation/plugin concerns. Camera
scanning and browser camera permissions are not added by recommending a QR display primitive.

Do not add a generic recovery-phrase component, account wizard, membership manager, new dialog,
or new status component to DUI for this feature. A labelled readonly text field, native controls,
and conditional composition suffice initially. A segmented code input needs independent evidence;
backend code lengths and formats must not be hardcoded into a universal six-digit control.

## Foundation-Owned Compositions

| Composition                                            | Required behavior                                                                                                                                                                          | Backend/consumer boundary                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Account establishment and explicit identity connection | Explain new versus existing identity; disclose backend-native authority and workspace discovery before explicit connection; distinguish pending/offline/failed/completed                   | Plugin supplies native steps and consequences; consumer decides where to present it                          |
| Recovery/backup                                        | Explicit reveal, warning and selectable value when applicable; saved acknowledgement separate from dismiss; restore validation and recoverable errors; passkey/native flow where supported | Sensitive values remain ephemeral and clear on exit/scope invalidation; recovery strategy stays plugin-owned |
| Second-device linking                                  | Explicit invitation start, code/link display or input, native challenge, waiting/retry/expiry/cancellation, actual completion                                                              | XState workflow owns flow lifetime; QR/copy are optional renderings, not proofs of access                    |
| Workspace invitation and membership                    | Show workspace and proposed access; prevent repeated submission while pending; report existing/accepted/expired/rejected outcomes; expose authorized role changes                          | Foundation handles outcomes; storage enforces access; app-specific domain grant screens stay consumer-owned  |
| Loading/operation feedback                             | Distinguish loading, local empty, ready, errors, local durability, and remote pending/rejection/unknown; offer safe recovery                                                               | DUI renders supplied state/messages; core/plugin owns observations and settlement evidence                   |

These are dialogs/popovers/embedded views, not a foundation-owned route, shell, workspace directory,
or full account settings screen. A shown role label never certifies enforcement of an app-required
restriction; backend-specific membership semantics remain documented in qualification.md.

## Interaction Defaults for Later Implementation Review

- Use a dialog or embedded view for multi-step or sensitive flows; use a popover for small choices.
  The consumer selects placement and owns navigation and the return-focus target.
- On open/step transition, focus the meaningful heading or first actionable field. On validation
  failure, identify/focus the invalid field with associated guidance. Verify this in composition
  acceptance; do not assume the generic dialog handles internal step changes.
- Keep one status announcement per operation. FieldFeedback describes fields; StatusMessage reports
  operation-level results. Do not announce secret values or repeat a spinner's message.
- Escape, close, unmount, and identity/workspace invalidation all invoke the same idempotent cleanup
  path. Cancellation clears transient material and requests native cancellation where possible;
  an already admitted device or durable write is not undone by closing the view.
- A saved-backup acknowledgement can gate an explicit Continue action, but cannot trap users in a
  secret-bearing dialog. Dismissal remains available and does not falsely record backup success.
- Supply all visible text/accessibility labels through consumer localization messages. Pure views
  accept props/callbacks; integration modules own actors, subscriptions, and backend calls.
- Source-backed flows inform behavior only. Keep the initial appearance wireframe-like with native
  CSS and DUI tokens; do not copy Composer styling or introduce a new visual direction.

No implementation or tests are authorized by this discovery. Later UI work still needs the
repository's task/review cycle and approval before its implementation tests are added or run.
