# Delightful Local-First Foundation Constitution

## Core Principles

### I. Jazz-First Delivery with Explicit Backend Boundaries

Jazz is the sole required v1 backend. SDK access MUST remain behind documented integration
boundaries for identity/session, workspaces/access, and typed consumer data operations. Ordinary
workflows and presentation MUST NOT call Jazz directly. Consumer-owned SDK-native schemas and
policies MAY remain in identified integration modules. Future backend replacement MAY require
schema/policy mapping and migration; source-compatible portability is not promised. Independent
plugin distribution, a universal schema language, and second-backend qualification are deferred.
App-required capabilities, permissions, and durability MUST NOT be silently weakened.

### II. Safe, Explicit TypeScript

New application and library code MUST use strict TypeScript and MUST NOT use `any`, type assertions
(including `as` casts), `switch` statements, or `case` clauses. Use `unknown` with narrowing, generics,
`satisfies`, typed adapters, lookup records, or clear conditionals. Model variants with discriminated
unions and required variant-specific fields rather than loosely related optional fields. Bundled
Spec Kit scripts remain inherited tooling and are outside these application-code restrictions.

### III. Explicit Stateful Workflows

XState actors and machines MUST own stateful foundation workflows: startup and shutdown, identity
and session lifecycle, recovery, device linking, workspace transitions, and operation lifecycles.
Cancellation, failure, retry, and cleanup MUST be explicit. Backend integrations MUST permit
backend-native methods and steps without pretending unsupported flows succeeded. Pure helpers and
simple presentation state MAY use ordinary functions and Svelte runes or stores; they do not require
machines. Workflow logic MUST remain separate from rendered presentation.

### IV. Domain and Presentation Ownership

The foundation MUST own reusable identity and workspace behavior, not Finance or Clipper domain
models or workflows. App-specific permission requirements MUST remain expressible and enforceable
through backend integrations. DUI MUST own generic presentation primitives; the foundation MUST compose them for
identity and workspace interactions. Missing DUI primitives MUST be documented as evidence-based
recommendations with explicit ownership, rather than assumed to exist or implemented implicitly.

### V. Reusable, Accessible Interactions

Account/recovery, device-linking, and workspace-membership dialogs, popovers, and reusable views MUST
be embeddable across consumer apps. Consumers MUST retain ownership of full screens, routes,
layouts, and domain workflows. Presentation components MUST receive data and callbacks through
props and render independently of backend sessions, queries, and XState actors; integration modules
and composition boundaries MUST connect those concerns. Components MUST NOT be created merely to
relocate templates.

Interactions MUST use semantic controls, support keyboard operation and meaningful focus and
dismissal behavior, and expose accessible operation feedback without duplicate announcements.
User-visible strings MUST be localizable from the beginning through Paraglide; reusable compositions
MUST support consumer localization. Transient sensitive recovery and device-linking information MUST
be cleared when its interaction ends. Detailed library localization integration remains a design
decision, not a requirement for consumers to adopt foundation-owned routing.

### VI. Explicit Data and Access Guarantees

Private workspace data MUST be protected at the backend/storage boundary, independently of UI
visibility. Shared workspace membership and available access levels MUST follow the selected
backend's documented model; the foundation does not require generic read-only membership. Additional
app-specific restrictions are required only when explicitly approved as consumer product requirements
and then MUST be enforced at the backend/storage boundary. Code patterns observed in a reference app
do not alone establish a product requirement. Qualification MUST document offline availability,
permission-change timing, revocation limits, failure semantics, and relevant capability limits.

Operations advertised as locally durable MUST survive an offline restart. Local acceptance,
durability, connectivity, and synchronization MUST NOT be conflated. Consumers MUST observe distinct
startup, loading, empty, ready, and error outcomes. Obsolete subscriptions MUST be released when
consumers, sessions, or workspaces change and MUST NOT expose another identity's data. These rules
constrain implementation of the user-approved shared data boundary and identity behavior recorded
in the active feature specification.

### VII. Reviewed and Verified Changes

Future production behavior MUST have appropriate automated coverage: unit tests for logic and state
machines, focused backend-boundary checks, and Playwright coverage for user-visible workflows,
authorization, and offline behavior where feasible. Implementation MUST be reviewed and approved by
the user before its implementation tests are added or run. After approval, required checks MUST pass
before the feature is considered complete. Jazz MUST demonstrate the agreed v1 required capabilities; a deterministic fake MAY support routine
tests but MUST NOT replace verification of Jazz persistence and storage authorization.

## Technology Constraints

- Shared UI MUST use Svelte 5 and DUI. Repository-owned app or demonstration hosting MUST use
  SvelteKit; reusable components MUST NOT require consumer adoption of its routes or layouts.
- Localization MUST use Paraglide. UI styling MUST use native CSS and CSS variables, without Tailwind.
  Until a visual direction is approved, repository-owned UI MUST remain unstyled and wireframe-like.
- Stateful workflows MUST use XState, with Svelte integration kept outside pure presentation.
- Use the installed Oxlint and Oxfmt tooling and repository configurations. These replace the prior
  Prettier policy. Preserve tabs, single quotes, no semicolons, no trailing commas, and 100-column
  width where supported; avoid unrelated formatting.
- Repository runtime and package-manager requirements are recorded in `package.json`; the lockfile
  pins installed tooling dependencies. Application toolchain compatibility, package boundaries,
  Svelte lint/type-check coverage, and detailed localization integration MUST be settled through
  design or tooling review before dependent implementation. Installed repository tooling does not
  establish application-stack compatibility or backend qualification.

## Development Workflow and Quality

- Follow the active feature in `.specify/feature.json` and its artifacts under `specs/`. Requirements,
  plans, and tasks MUST remain aligned before implementation of dependent work.
- The current phase remains specification-only. Foundation code, plugins, demonstrations, and
  consumer migrations MUST NOT be implemented without a new instruction authorizing that work.
- Follow the user's resolved Q1 (shared data abstraction) and Q2 (cross-app identity) decisions in
  the active feature specification. Other unanswered consequential decisions MUST remain explicit
  until resolved; dependent contracts MUST NOT treat assumed answers as approved requirements.
- Jazz alone MUST qualify against the agreed MVP capabilities. Additional backend evaluation and
  independent plugin contracts are deferred and MUST NOT gate v1.
- Complete one task at a time and present it for review before starting another. Change no more than
  one route or component per review cycle unless the user authorizes otherwise.
- Do not add or run implementation tests before approval of the implementation they cover. Document
  review and static consistency checks MAY validate specification artifacts in this phase.
- When starting a development server, tell the user and provide its URL. Never commit or publish
  without explicit authorization.

## Governance

This constitution governs project design and implementation and supersedes conflicting repository
conventions; explicit user instructions take precedence. Every feature plan MUST state compliance
with these principles and identify unresolved decisions before dependent work begins.

Amendments MUST explain their rationale and affected artifacts and be presented for user review.
Approved amendments MUST reconcile affected specifications, plans, and repository guidance through
explicitly scoped review tasks. Deferred reconciliation MUST be recorded rather than silently treated
as complete. The initial tooling follow-up is complete: repository configuration and `AGENTS.md`
now use Oxlint/Oxfmt. Subsequent design proposals remain subject to their own review.

Constitution versions MUST follow semantic versioning: MAJOR for incompatible principle removals or
redefinitions, MINOR for new principles or materially expanded guidance, and PATCH for clarifications
that do not change obligations. Amendments MUST preserve the original ratification date and update
the last-amended date. Compliance reviews MUST check backend boundaries, guarantees, ownership,
accessibility, unresolved decisions, and the applicable review and validation gates.

## Amendment Rationale — 2026-10-31

Version 2.0.0 replaces the mandatory independently distributed multi-backend MVP with Jazz-only
v1 delivery at the user's explicit request. The shared data boundary remains, while portable
schema expression and a second real backend cease to be release requirements. Strict typing,
XState ownership, privacy, accessibility, and implementation review gates remain in force.
The active spec and repository guidance are reconciled in this documentation change. The old
technical plan is marked superseded; detailed design artifacts require reconciliation in the
next reviewed planning task before implementation. This amendment does not authorize code.

**Version**: 2.0.0 | **Ratified**: 2026-10-14 | **Last Amended**: 2026-10-31
