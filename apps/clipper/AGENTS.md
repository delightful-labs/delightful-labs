# Clipper project guidance

Read the [workspace entry](../../AGENTS.md) and shared guides first. The user’s
stricter common engineering rules apply here. Existing product, extension, SDK
and worker qualification below remains scoped to Clipper. Every PR uses the
shared Conventional Commits check; no local title exception applies.

- Follow `specs/001-jazz-clipper/spec.md`, `plan.md`, `design-decisions.md`, and `implementation-handoff.md`. Keep accepted scope cuts intact.
- The workspace tooling, account integration and private library root are implemented; URL-first capture, dedicated reader workflows and bounded inline offline raster images are implemented; annotations and broader product/release qualification remain open. The prototype and isolated proof scripts are archived on `archive/pre-jazz-rewrite-2026-11-02`; do not restore its legacy dependencies or source as the implementation baseline.
- Use the selected strict TypeScript, Svelte 5, XState, DLF identity/recovery, DUI presentation and i18next boundaries. Model state/resource ownership before implementing asynchronous workflows.
- XState memory is binding: read [docs/memory/xstate.md](docs/memory/xstate.md) before designing, changing or reviewing workflows, persistence, actor lifetimes or notification handlers. Apply its ownership rules before implementation; renaming or extracting callbacks is not a substitute for modeling decisions and data flow in the owning chart.
- Clipper owns domain schemas/policies and data operations; DLF owns reusable identity/recovery behavior; DUI owns generic presentation. Do not silently adopt a sibling repository's constitution or copy its domain models.
- Keep implementation scoped to the current user request; Add Link immediately saves a URL article through the same operation that optionally accepts supplied content. A dedicated Web Worker machine processes articles missing content one at a time. Do not reintroduce a separate intake graph/journal or main-thread capture orchestration.
- First web-app use must open a usable local library without signup, following Finance's DLF/Jazz `initial: 'local-first'` integration. Reuse the persisted local identity; recovery/restoration is optional, and remote connectivity must not gate local readiness. Do not reintroduce a Create account screen as the initial product gate.
- Extension capture requires a confirmed connection to an existing account. A toolbar click without that connection opens a trusted sign-in popup; after successful DLF restoration the original gesture may continue. A silently created/persisted local identity alone is not sign-in. Model admission, popup lifetime, restoration confirmation and native account verification with XState. Keep web no-signup behavior unchanged and credentials out of page code.
- Use DUI default presentation for the app shell and controls, following Finance's composition patterns. Keep Clipper CSS limited to structural layout; do not add a separate palette, card skin, font system or decorative styling around DUI components.
- Use DUI input components for user-entered fields. A silently initialized local Jazz identity must not expose Sign out; that control is reserved for an explicitly signed-in identity. Keep recovery/restoration available without signing out of local mode.
- Saved readers are dedicated SvelteKit pages linked by document URL, not inline library panels. Keep session/capture actors in the application layout, use normal anchors for navigation, and qualify direct/offline reader URL loads.
- Read [localization memory](docs/memory/localization.md) for Clipper catalog layout;
  the shared guide owns copy approval.
- Prefer readable, localized state names (`meta.name`) for workflow feedback. Put outcome selection in explicit states and transitions; selectors should project the active name rather than reconstructing a message from failure/status flags. Forward dynamic feedback from its owning child machine.
- Workflow status/error messages belong to the state machines. Call the localization library directly in the owning machine and expose ready-to-render text/severity; Svelte components must not map machine status/error codes to translation keys.
- Use Zod schemas for untrusted input shapes and bounds, and infer the corresponding DTO types. Keep domain relationships and workflow eligibility as named predicates/actor guards. Preserve caller error mapping and representation-sensitive limits; never expose rejected input or raw Zod errors in product responses or diagnostics.
- Compose related Zod schemas from their canonical schemas with `pick`, `omit`, `extend` and `shape` references instead of redeclaring shared fields and constraints. Derive DTO types with `z.infer`. Apply whole-record refinements at the appropriate composed boundary so related forms share field validation without inheriting unrelated invariants.

- XState v6 migration follows [the migration/design specification](specs/001-jazz-clipper/xstate-v6-migration.md), including its installed-documentation review and source/native acceptance gates. Use published XState without patches or declaration overrides; the separately qualified Jazz patches retain their own ownership.

- In this monorepo, the scoped active feature is selected by `.specify/feature.json`.
  Shared helpers resolve this coordinator; run them here or set `SPECIFY_INIT_DIR`.
  Product policy and `specs/001-jazz-clipper` remain binding for product work.
