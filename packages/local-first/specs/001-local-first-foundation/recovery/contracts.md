# Recovery Slice Public Contracts

**Status**: Proposed interface design for review; names remain provisional until Finance validation.

## Independent Entry Points

| Proposed import                                | Exposes                                              | Must not import                                      |
| ---------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `delightful-local-first/recovery`              | Pure RecoveryPhraseView and actor-free contracts     | Jazz, XState, integration modules                    |
| `delightful-local-first/recovery/workflow`     | Machine factory and view selector for advanced hosts | Jazz, Svelte, DUI, app catalogs                      |
| `delightful-local-first/recovery/svelte`       | RecoveryPhrase owned actor/view composition          | Direct Jazz calls or host routes                     |
| `delightful-local-first/backend/jazz/recovery` | Narrow host-handle capability adapter                | New session/provider/client or Finance code          |
| `delightful-local-first/recovery/messages`     | RecoveryMessages and English message factory         | Host locale runtime, routes, private Finance catalog |

No global backend registration or full app bootstrap is necessary. Use explicit package exports;
root barrel must not pull all optional integrations into every import. The current empty package
root may remain empty until useful actor-free exports are reviewed.

Svelte retains its peer dependency. XState, DUI, and Jazz versions used during validation are pinned
in development; dependency/optional-peer declarations must reflect which public subpath needs them.
Jazz and DUI are host-supplied peers for their optional entries and must not be bundled. Missing
optional peers fail only when a dependent entry is imported; ordinary view/workflow use must not
force a Jazz installation. No claim of independently distributable backend plugins is introduced.

## Host Binding and Jazz Adapter

The host supplies an available/unavailable scope and a matching phrase-read capability. The
capability includes a total, synchronous `isCurrentScope(scope)` predicate over current binding facts
(no I/O), checked before reveal/retry and before accepting output. The host must publish immutable
scope observations promptly; the predicate cannot replace invalidation of an already displayed view.
The supplied capability is fixed for one machine instance. If the capability itself is replaced,
shut down the old actor before creating a new one; OBSERVE updates scopes served by the same capability.
Available
scope consists of identity ID plus non-secret dependency token and generation. The host observes
identity/session changes using its existing SDK integration. The source adapter captures scope
against its current account accessor and performs a final same-handle/same-ID/same-generation check
immediately before exporting the root. It rejects stale or unsupported input without revealing.

Actual AccountHandle types and raw credentials are confined to the backend adapter. Do not pass
an AccountHandle as the machine's opaque token. No actor context/event/input, view model, message
factory, or host callback receives raw root material. The phrase itself is returned only to the
invoked reveal operation and revealed view, not a second credential store.

The scope publisher advances generation for actual handle replacement and replaces dependency token
for session/environment/adapter replacement. It preserves them across unrelated renders. Adapter
binding validation and host observation delivery form one integration boundary: there must be no
window where a stale displayed phrase is knowingly associated with newly exposed identity controls.
All retry paths recheck capability. Async invoke results are correlated with the captured scope;
cancelled invocation output cannot reopen a closed interaction.

`exportLocalFirstSecret` and `RecoveryPhrase.fromSecret` remain a synchronous, resource-free leaf
inside the Jazz module. A promise actor may adapt this single leaf for workflow error/cancellation
semantics. Do not introduce reads, bootstrapping, recovery, or policy branches inside its body.
Unsupported issuer/root and scope mismatch map to sanitized capability outcomes; no fallback
account creation, sync request, or recovery of another identity is permitted.

The adapter must resolve to Finance's physical Jazz module instance: alpha.59 credentials are stored
in a module-private WeakMap. Peer metadata alone does not prove this; inspect packed output and
validate a host-issued account handle through the installed package in Finance.

## UI and Localization

Pure view props: a discriminated recovery view model, a complete RecoveryMessages object, and typed
callbacks for reveal, retry, and hide. The user removed acknowledgement controls during view review. It does not receive an actor ref,
SDK handle, or multiple flags from which it must infer authorization. Owned composition adds initial
scope/current observations and the leaf capability; its actor lifetime is independent from messages.

The implemented message contract includes description, heading, show, warning, phraseLabel,
close, pending, failure, unavailable, and retry. The factory resolves
reusable actions/nouns/labels internally and returns full strings rather than exposing catalog keys.
No string interpolation receives phrase text. Security instructions stay contextual whole messages.

Initial bundled locale: English. `createRecoveryMessages('en', overrides?)` resolves every message
with explicit locale and allows typed partial English wording overrides. Hosts supplying another
language provide a complete RecoveryMessages object. Do not silently fall back part of a claimed
non-English interface to English; a future bundled language extends the typed supported-locale set.
Library Paraglide runtime is private; each request/component owns its resolved text. No global locale
setter, provider requirement, cookies, URL routing, or consumer compiler plugin is introduced.

A host uses a reactive derivation when changing locale/overrides; only message props change. A view
must not cache translated text in actor context. Generated message JS and declarations ship with the
library; raw catalog JSON, generated server runtime, and private compiler APIs are not public imports.
Compile in ordinary message mode with declarations; explicitly verify emitted calls use supplied
locale before packaging and keep static/per-locale specialization disabled.

DUI supplies native dialog and fields. Derive unique warning/field/heading associations per instance;
never copy Finance's fixed IDs. All close/Escape/backdrop/unmount/scope-invalidation paths reach the
same idempotent clear path. The view exposes one Close action with no acknowledgement requirement. Keep loading/failure feedback in one non-secret live
region and phrase out of live announcements. Use existing DUI tokens and scoped layout only; no
implicit theme/reset import or new public CSS properties are needed.

Host focus ownership: the view owns focus on meaningful dialog content and retries; native modal
close returns to its initiating trigger where it still exists. Consumer navigation owns alternate
focus when the trigger is removed. Do not promise native focus return on an unmounted trigger.

## Cleanup, Inspection, and Adoption

Owned composition shuts down its machine, clears phrase/acknowledgement/binding references, removes
its view/subscriptions, and stops local actors. It must never log out, stop, or recreate the host
session/client. Adapter closures no longer used must release captured handle access. Default
composition offers no raw inspection hook; advanced direct-machine consumers own the same privacy
obligations. Errors and outcome callbacks are sanitized; no copied snapshot history or backup flag.

The first Finance adoption changes its existing RecoveryPhraseIntegration and imports at the account
mount only as needed. Replace obsolete recovery machine/view/contracts once their last consumer
migrates within reviewed scope. Leave Finance's restore form, provider, navigation, schemas, and
workspace lifecycle alone. Do not refresh DUI as a prerequisite. Package/vendor updates must retain
one referenced archive per dependency according to Finance's working agreements.

A built-package consumer checks types/subpath exports independently of source aliases. The later
Finance integration is the runtime proof of host-session/module identity and continued unrelated
workflow usability. Both checks are required; neither alone stabilizes the interfaces.

The owned source/capability composition and Jazz adapter are documented in
[recovery integration](../../../docs/recovery-integration.md). Their runtime verification remains
pending implementation review and the separately authorized Finance adoption.
