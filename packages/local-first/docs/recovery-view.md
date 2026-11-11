# Recovery presentation and localization

This cycle adds a pure DUI-based `AccountRecovery` view. It receives a `RecoveryPhraseView` model,
a complete `RecoveryMessages` object, and callbacks. It creates no actor, Jazz session, subscription,
or persistence. The [owned integration and Jazz adapter](recovery-integration.md) are now implemented separately
for review; this document describes the pure-view boundary.

## Public imports

```ts
import { AccountRecovery } from 'delightful-local-first/recovery'
import type { RecoveryPhraseView } from 'delightful-local-first/recovery/contracts'
import { createRecoveryMessages } from 'delightful-local-first/recovery/messages'
```

`recovery` retains existing type exports and adds the AccountRecovery component. `recovery/contracts`
is an actor-free, UI-free entry for non-Svelte consumers. `recovery/workflow` remains independent of
DUI, Jazz, and localization. Rendering the view needs Svelte 5 and the host's DUI peer; this cycle
pins development to Finance's exact 0.0.25 details-animation archive. The package never imports the
optional DUI theme or injects a global reset. The Storybook preview explicitly imports DUI theme.css
so the workbench demonstrates the shared typography and theme defaults. There is no Jazz peer or adapter in this cycle.

The view's callback props are onReveal, onRetry, and onHide. Connect
them to the corresponding reviewed machine events. The host still owns identity/scope observations
and must synchronously invalidate them when it learns of a change. Pure view callbacks request
intent; machine guards own actual scope eligibility.

## Messages

`createRecoveryMessages('en', overrides?)` resolves a library-owned Paraglide catalog and returns
all required text. Optional overrides replace complete strings. English is the only bundled locale; unsupported factory locales throw rather than silently falling back.
for another language, supply a complete typed RecoveryMessages object rather than pretending partial
English overrides are a supported translation. The recovery phrase itself is never translated.

The host determines locale per request/component and recomputes message props reactively. There is
no library locale setter/store, app cookie, middleware, or route requirement. Every generated message
call receives an explicit locale argument. Sharing these pure message functions does not mutate
another app's or request's locale. The view takes resolved text and never stores it in workflow state.

Paraglide 2.27.0 compiles messages/recovery/en.json using the pinned message-format 4.0.0 plugin.
The first compiler run needs access to that plugin's CDN. Generated JS and declarations under
src/lib/paraglide are ignored in Git and regenerated before check, package, and Storybook commands.
They ship privately inside dist; package exports do not expose the generated runtime/server module.
Authored-code lint/format rules exclude generated output; it still participates in type/package checks.

Run `pnpm paraglide --watch` alongside the workbench when editing message catalogs. Source component
changes use normal Storybook HMR. Generated files must never be edited directly.

## Interaction and privacy

Per-instance IDs associate the warning and phrase field; native DUI dialog behavior handles modal
focus and dismissal. Close appears below the phrase, with native autofocus so initial modal focus does not target
the secret field. The open event moves focus to the warning. The clicked reveal/retry trigger is retained for focus return because disabling it during the
local operation interrupts native focus restoration. The close event restores focus only if that
trigger remains connected. Closing via native events or unmount requests
the same idempotent hide callback; scope/actor shutdown remains integration-owned.

The dialog has one Close action. No checkbox, saved-phrase declaration, or acknowledgement is required.
Phrase markup only exists for the revealed variant. Loading, unavailable, and failure messages use
one persistent non-secret feedback region. No phrase appears in live-region text or message inputs.
Callbacks must update the supplied view; the pure component cannot revoke a phrase retained by its
caller. Clearing DOM/references does not promise JavaScript memory erasure or clearing a clipboard.

## Review and verification

The Storybook examples use only an obviously synthetic phrase and the existing real machine. The
example host owns each actor and shuts it down on unmount; no Jazz, account handle, or credential is
present. Stories cover reveal/close, unavailable, retryable failure, wording overrides,
and independent instances. No browser server or implementation test is required to build the stories.

Verification includes message compilation, strict checks, lint, package validation, built-export
consumer checks, and the static Storybook build. The consumer fixture checks Node-compatible entries
directly and builds the view with Svelte-aware Vite against dist exports, not source aliases.

After user review, localization unit coverage was added for English templates, explicit locale use,
independent overrides, immutable inputs, and unsupported locales. Chromium coverage exercises native
dismissal/focus return, no acknowledgement checkbox, Close below the phrase, unique IDs/descriptions,
failures and retry, reactive messages, availability invalidation, and unmount/remount cleanup. Host
controls in the synthetic story supply those changes without inspecting private actor state. Assertions
check behavior, native semantics, and layout bounds rather than CSS classes or computed styles.

## Running focused coverage

- `pnpm test:unit --run src/lib/localization/recovery.test.ts` compiles catalogs and runs localization checks.
- `pnpm exec playwright install chromium` installs the browser once.
- Build with `pnpm build-storybook`, then run `pnpm test:storybook --workers=1` against a disposable
  static preview on port 6008. CI performs that build and starts its own preview with server reuse off.
- For the known agent review server already running on 6008, use
  `PLAYWRIGHT_REUSE_SERVER=1 pnpm test:storybook --workers=1`. Never enable reuse for an unidentified server.
- Set `PLAYWRIGHT_PORT=6010` (or another free port) for an isolated preview. No user server is stopped.

This suite uses only synthetic phrase text. It does not qualify Jazz integration, cross-browser
behavior, real-account artifact handling, or concurrent request SSR rendering. Those require their
own later implementation review and focused coverage. No Finance data or browser storage is touched.
