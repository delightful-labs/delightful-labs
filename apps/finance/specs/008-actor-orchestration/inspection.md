# Actor inspection decision

## All-machine error diagnostics — reviewed and tested

Requirement: when `PUBLIC_DEBUG=true`, report normal error states, failed/unavailable terminal
results and unexpected actor failures across every existing application root and its descendants.
Jazz initialization errors must include the available public connection configuration and retained
error/cause details. Deploy previews enable this flag in `netlify.toml` during the next build.

Design: use the existing XState inspection attachment as an observation boundary, before the
Stately projection discards private context. The synchronous diagnostic adapter projects only
status/permission facts, correlation counters, collection sizes and typed outcome descriptors;
error text/source frames are redacted and bounded, and cause chains are capped. It reads only data
properties, except the explicit SDK `getConfig` operation. It never dumps SDK objects, records,
form values, provider responses, credentials or raw events. A weak map stores only a prior
diagnostic fingerprint per observed actor, for duplicate suppression. It cannot discover, command
or supervise actors and does not mirror their lifecycle. No statechart, workflow, actor ownership,
permission, persistence or cleanup protocol is changed. The existing shared-session promise catch
keeps its original reset/rethrow behavior and adds only a failure-isolated diagnostic leaf.

The remaining account archive/delete-grant, account-order, recovery-phrase, sample-transaction and
PWA roots now attach the same observer. This also makes their sanitized charts available through
the explicit Stately menu action. Console diagnostic context is not transmitted to Stately.

- [x] Implement startup configuration/error reporting, error-state projection and root attachment.
- [x] User approved testing this implementation.
- [x] Cover native failures (including initialization), handled error/unavailable
      outcomes, error/cause/stack redaction, context projection, getter avoidance, deduplication and
      retry, disabled debugging, and preservation of the original Jazz startup rejection.
- [x] Inspect affected logger, inspector and Jazz session coverage before targeted checks.
- [x] Browser verification injects a deliberate Jazz session-storage failure, checks enabled
      diagnostics and disabled silence, confirms no automatic popup, and recovers through retry.
- [ ] Reproduce the hosted workspace-preparation failure. These local checks do not establish
      the cause of the Netlify preview failure.

Verification in the isolated checkout: 123 unit tests passed across 11 targeted files; application
and browser-test type checks passed. Three debug-enabled browser cases and two debug-disabled
cases passed; disabled-mode HMR is intentionally skipped. One disabled retry run overlapped a
unit run that regenerated development files and failed; the browser-only rerun passed. Future
unit and browser checks in the same isolated checkout must also run sequentially.

Expected denied/unavailable machine states produce error-level diagnostics, even during normal
startup. Error properties exposed only through accessors (including DOMException messages) are
omitted to preserve the getter-avoidance rule. No claim of complete native-error text coverage
or hosted-deploy verification is made.

The custom development trace adapter, browser API, actor wiring and dedicated tests were removed
at the user's request in favor of using the XState tooling ecosystem when inspection is needed.
The Stately integration below replaces that removed custom tooling.

## Stately Inspector — reviewed scope and verification

Requirement: use `@statelyai/inspect` behind the sole `PUBLIC_DEBUG` gate, on the browser only,
to observe state topology, actor relationships, state values and event types. Never transmit live
context, input/output, raw errors, finance records, credentials or provider payloads.

User-directed follow-up: popups must be initiated from the developer menu, never at startup.
The menu exposes Stately and standalone Jazz inspector actions. Stately uses `autoStart: false`
and opens synchronously on the explicit menu click, focusing an existing popup when possible.
Its 200-event history is supplemented by at most 1,000 sanitized machine-registration/current-state
descriptors, replayed on a verified popup handshake. This is diagnostic data only, not an actor
registry: it holds no actor references and cannot send application commands or change ownership.
Replay avoids losing existing machine graphs when startup events roll out of the SDK buffer.
The synchronous resource adapter owns listeners, popup acquisition and disposal; no async business
workflow or duplicated lifecycle flags are introduced. HMR clears the descriptor cache.

Real hosted-receiver verification exposed an additional failure masked by the former local popup
fixture: the SDK's default definition depth of 10 replaced deep state nodes with `"[Object]"`,
crashing Stately's renderer. A depth limit of 100 now preserves our composed charts; a 16-level
unit fixture checks that state nodes are not truncated. The browser fixture now uses an actual
cross-origin popup and handshake, and a manual unmocked check confirmed that the hosted Stately
page renders `application-readiness` when opened from the menu, with zero automatic popups.

Ownership and machine-first assessment: this is a synchronous diagnostic adapter at existing
actor creation points, not a business workflow. One lazy browser inspector owns its popup and
bounded 200-event buffer. XState owns inspection propagation to child actors; existing integration
components retain actor creation, startup, replacement, drain and shutdown. HMR disconnects the
inspector, aborts its module-scoped browser listeners, and prevents retired callbacks from
reattaching. This is synchronous resource-adapter cleanup; no business workflow or actor ownership
changes are introduced. No actor registry, reparenting or message routing is introduced.

The official SDK's `sanitizeContext` and `sanitizeEvent` hooks discard context/event payloads;
its serializer additionally rebuilds snapshots without results/errors/children and strips data
fields from static machine definitions before the adapter buffers or transmits them. Inspection
attachment failures produce only a generic debug warning. State values and names are static
machine identifiers, not domain record identifiers. Browser popup permission may be required.

CI follow-up: the SDK converts snapshot events to JSON before invoking its sanitizer hooks.
The integration now projects native snapshot events before forwarding them to the SDK, so live
Jazz clients and private context are never traversed by that conversion. A real-SDK regression
test uses a getter inside private context and verifies it is never read. Dedicated true/false
debug browser jobs run `playwright.debug.config.ts`; the general application suite excludes this
file because it requires that config's metadata and inspector transport fixture. Failed general
browser jobs retain their error-context artifacts for diagnosis.

The remaining application CI failures were confined to the standalone form-presentation HTML
fixture, which bypasses the normal SvelteKit app entry. Since the shared form controller now
imports the environment-gated inspector, that document must load Kit's generated environment
bootstrap before its entry module. All nine form-presentation browser scenarios passed after
that fixture correction, verified in a checkout with separate dependencies and generated files.

- [x] Install the official inspector and implement sanitized, environment-gated attachment.
- [x] Attach the application root (including startup/workspace/bank descendants), shared scoped
      forms, and the independent transaction editor root without changing their ownership.
- [x] User approved testing this implementation.
- [x] Verify disabled/SSR no-op behavior, topology and event redaction, result/error
      removal, definition redaction, popup behavior, and child propagation through the real SDK.
- [x] Redact runtime actor names and internal completion/error/snapshot event suffixes that may
      contain provider account IDs. Preserve static machine names and generated session IDs.
- [x] Verify HMR disposal and replacement through Vite's live browser update pipeline, without
      editing shared source files. The regression check confirms one disconnect, one replacement
      popup, fresh inspection events, no replay of the retired inspector's buffered events, and no
      reattachment through retired callbacks. The test exposed that SDK `stop()` leaves a message
      listener behind; a module-scoped abort signal now owns and removes that listener.
- [ ] In a subsequent reviewed batch, attach the independent account archive/delete-grant,
      recovery phrase, account order, sample transaction, and PWA update roots.

## Lower-environment logging — reviewed scope and verification

Requirement: application console diagnostics and the developer menu run only when the build-time
`PUBLIC_DEBUG` setting is exactly `true`. Vite defaults the setting to `true` for development
serving and `false` otherwise, preserving shell and mode-specific env-file overrides. An explicit
local `false` disables the menu and application logs. Other deployed builds remain silent. SDK logging and
service-worker development behavior are independent of this flag.

Plan: declare the validated public setting, centralize console emission in `src/lib/logger.ts`,
and migrate bank traces and transaction diagnostics. Keep the existing bank error allowlists and
use that classifier for transaction errors instead of raw messages, stacks or causes. No actor
ownership, workflow or persistence changes are required; the existing trace resource adapter
continues to clear its heartbeat in `finally`.

- [x] Implement the environment gate and scoped scalar-only logger.
- [x] Migrate existing application console calls and document deployment setup.
- [x] Extend the same gate to the developer menu and sample transaction controls, including
      their subscription and write guards. Preserve existing presentation and permission checks.
- [x] User approved testing the implementation.
- [x] Add unit coverage for development, explicit opt-in, default/false deployed
      builds, all logger levels, error classification, and trace heartbeat cleanup.
- [x] Verify debug-enabled and explicitly disabled agent-browser behavior, including menu absence,
      inspector attachment, form payload redaction and authorized sample creation.
- [x] Verify an optimized production build and a browser smoke check of its inspector/menu startup.
      This smoke uses a dummy unreachable Jazz URL and does not claim hosted workspace coverage.
- [ ] Production-build sample creation and disabled-production browser checks remain unperformed;
      the equivalent development flag paths and build-mode configuration precedence are covered.

Verification uses `src/lib/{logger,inspector,debug-config}.test.ts`,
`src/lib/integrations/diagnostics.test.ts`, existing SimpleFIN/passkey tests, and the affected
application-readiness/scoped-form/transaction-edit/sample-transactions tests. Browser coverage is
`tests/debugging.e2e.ts` with `playwright.debug.config.ts`: explicit true/false agent runs and an
enabled production smoke. The fixture intercepts popup communication locally instead of sending
test data to Stately and explicitly isolates Jazz settings from developer `.env` credentials.

Jazz inspector assessment: the installed alpha.59 provider attaches its overlay only outside
production, and its Vite plugin serves inspector assets through development middleware. The
documented supported hosted-server path is the standalone Jazz Inspector. The debug flag does
not claim to enable a deployed overlay. No embedded inspector changes are included in this cycle.

XState provides an inspection API; Stately Inspector consumes it to visualize state machines and
actor communication. Evaluate that tooling before adding custom instrumentation. Any future
integration must exclude provider credentials and private finance payloads (FR-015).

The earlier custom implementation passed its scoped checks before removal. Historical test counts
in the feature artifacts describe that implementation and do not represent verification of this removal.

Removal verification: all 1,042 src/lib unit tests passed. All 34 selected browser cases passed,
including reruns after correcting stale route, workspace URL and checkbox-label expectations in
the existing account-order, pagination and authentication tests. Coverage includes shared forms,
account archive/order, sample transactions, recovery phrases, avatars and session recovery.
Application and test type checks passed. No unrelated full browser-suite rerun is claimed.
