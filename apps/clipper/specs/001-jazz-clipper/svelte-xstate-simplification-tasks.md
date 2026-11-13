# Svelte and XState simplification tasks

Status: Research started. Implements [the specification](svelte-xstate-simplification.md).
Initial findings and proposed pilot: [research record](svelte-xstate-research.md).
Unchecked items are planned work, not completed validation. Keep implementation
batches to the shared review limits; no dependency or test approval is implied.

## A. Establish the design and evidence

- [x] A1. Recheck installed XState/Svelte versions, source and public declarations.
      Record selector initialization, equality, failure/completion, resubscription
      and SSR behavior. Separate verified behavior from remaining questions.
- [x] A2. Inventory observation and ownership in `Application.svelte`, `Library`,
      `AddLink`, `ArticleTags`, reader route, worker client/host and extension UI
      callers. Identify existing keyed lifetimes and public protocol consumers.
- [x] A3. Compare installed `useSelector` plus a typed worker source adapter with
      a native Svelte adapter. Specify source replacement, initial render, errors,
      cleanup and semantic equality. Show a concrete proposed component API.
- [x] A4. Write the lifecycle audit table required by the spec: worker transport,
      application/library, reader surfaces, SDK acquisition/session, account-store,
      broker, transaction settlement and custody. Trace relevant DLF/Jazz source.
      Mark unsupported claims unresolved instead of repeating historical guidance.
- [x] A5. Present the chosen observation design and any lifecycle/policy changes
      for review. If `@xstate/svelte` is chosen, request its explicit dependency
      approval with the existing-package and native-adapter alternatives.
      User approved adding `@xstate/svelte@6.0.0-beta.0` to Clipper on 2026-11-13.
      No lifecycle/policy change is part of the selector pilot.

Exit: a reviewable observation contract and ownership map. A selector pilot may
proceed after its design is accepted without waiting for unrelated lifecycle
research; no shutdown change proceeds with an unresolved safety justification.

## B. Qualify one small selector pilot

- [x] B1. Implement the selected typed observation boundary and migrate `AddLink`
      only. Select capture capabilities/messages without changing save behavior,
      form semantics, copy, worker ownership or receipt-based command admission.
      Added `runtime/worker/view-source.ts`; the feedback follow-up leaves four
      selected stores in AddLink, including one optional machine-owned message.
      Capability selection now uses the client's current value on first render.
- [x] B2. Show the concrete implementation and removed boilerplate for review;
      obtain implementation-test approval under the shared testing guide.
      User authorized tests and a PR on 2026-11-13 after reviewing the pilot.
- [x] B3. Run focused approved checks for initial value, unchanged selection,
      subscribe/unsubscribe/resubscribe, errors and account replacement. Verify
      comparator fields and that the real client remains alive after UI disposal.
      Six new selector tests and six existing client tests pass against the real
      UI client with a fake native Worker. Full web/extension types pass in an
      isolated checkout after building matching UI/DLF artifacts.
- [ ] B4. Verify the actual browser capture flow and failure feedback, not only
      the adapter. Record subscription behavior and limitations of the probe.
      Attempted selected account/capture Playwright cases on isolated ports
      5198/5199. Environment refused the server listen with EPERM; no browser
      cases executed. Browser qualification remains open, including discovery
      duplicate/restore and invalid-source feedback cases.
- [x] B5. Consolidate Add Link status display in the owning capture states.
      Capture state metadata declares text, severity, display eligibility and
      status priority. Remove separate frontend duplicate/error messages and
      cross-channel selector fallbacks. Preserve the extension's detailed status
      and quiet web progress/success behavior. Other workflow regions remain
      separately scoped; this does not complete the broader feedback audit.

Exit: accepted pilot with no custom selector framework or lifecycle regression.

## C. Apply the established observation pattern

- [ ] C1. Migrate `ArticleTags` in its own review cycle; preserve write feedback,
      dialog dismissal and focus recovery, including an article leaving filters.
- [ ] C2. Migrate `Library` in its own review cycle; preserve search/filter state,
      pagination, row focus after removal and tag-editor continuity.
- [ ] C3. Migrate reader observation in its own review cycle; preserve document
      identity, open/close commands, late-report rejection and content revisions.
- [ ] C4. Remove superseded active helpers only after locating consumers. Trace
      older `Account.svelte`/library context separately; do not delete fixtures or
      compatibility paths merely because the active layout does not import them.

Exit: each migrated component has one clear observation lifetime; no stale data
or application restart on route changes. Review and approve affected checks for
each batch before running them.

## D. Simplify lifecycle only where the audit supports it

- [ ] D1. Select one evidence-backed simplification from A4. Show the operation,
      owner, states, native cancellation contract and before/after failure cases.
- [ ] D2. Amend any conflicting active guidance with explicit approval before
      changing the dependent implementation. Retain historical evidence.
- [ ] D3. Implement the bounded change with standard invocation/cancellation/
      cleanup where sufficient. Preserve a minimal closing workflow only where
      asynchronous settlement is actually required.
- [ ] D4. After review/test approval, qualify cancellation during acquisition,
      issued writes, close failures, overdue close and late completion as relevant.
      Include actual SDK/worker behavior, not just mock acknowledgments.
- [ ] D5. Qualify abrupt termination separately from graceful closure: the same
      offline library reopens, acknowledged durable edits remain, unknown outcomes
      reconcile without automatic mutation replay. Report unproven guarantees.

Exit: explain which machinery was removed or retained and why. Finding that a
boundary is necessary is a valid result; this phase has no removal quota.

## E. Follow through on Svelte composition

- [ ] E1. Propose reader responsibility boundaries for observation, surface DOM,
      footnotes, settings and route identity; preserve snippet composition.
- [ ] E2. Extract one responsibility per review cycle. Keep route composition
      visible and avoid a controller or prop object that conceals the same work.
- [ ] E3. Replace duplicate media-query subscription plumbing with `MediaQuery`;
      preserve breakpoint-dependent opening behavior and hydration assumptions.
- [ ] E4. Evaluate attachments for saved-content/surface lifetime. Keep unrelated
      image/progress updates from replacing article DOM; preserve syntax/image
      cleanup and final reader-position reporting.
- [ ] E5. Consolidate repeated account/page frame layout through snippets and
      supported DUI APIs. Propose shared drawer improvements in DUI if needed.
- [ ] E6. Adopt typed context where it improves integration scoping; reduce
      imperative component traversal while retaining narrow focus operations.

Exit: changes preserve native keyboard/forms/navigation, focus, modal inertness
and reader selection. No new UI copy, decorative styling or dependencies arise
incidentally. Each change gets appropriate reviewed validation.

## F. Close the work with an honest qualification record

- [ ] F1. Run approved scoped formatting, lint and type checks, then affected
      integration/browser/offline checks. Include extension callers if shared
      host/client protocols changed. Use isolated fixtures and preserve user data.
- [ ] F2. Record exact package versions, decisions, removed duplication, test
      evidence, remaining custom lifecycle boundaries and unresolved limitations.
- [ ] F3. Update active integration guidance to describe the qualified pattern.
      Keep the migration feature selector unchanged unless explicitly reassigned.
