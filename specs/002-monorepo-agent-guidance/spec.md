# Feature Specification: Delightful Labs Monorepo and Shared Agent Guidance

**Feature Branch**: `spec/monorepo-agent-guidance`

**Created**: 2026-11-10

**Status**: Draft — specification for review; migration implementation has not started

**Input**: Consolidate Delightful Clipper, Delightful Finance, Delightful UI,
Delightful Local First, and the Delightful Labs website into the Delightful Labs
repository. Start with pnpm workspaces without Nx. Consolidate agent guidance so
shared best practices stay current across projects. Open a specification PR;
implementation is later work.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Maintain shared agent practices once (Priority: P1)

Matt updates a reusable engineering practice once. Agents working on any relevant
app or library find the same current instruction, together with the rules specific
to their task and project.

**Why this priority**: Keeping agents current across repositories is an existing
maintenance problem. Combining source code alone would leave that problem intact.

**Independent Test**: Review the applicable guidance for a UI component change, a
Local First workflow change, a Finance domain change, a Clipper extension change,
and a website publishing change. Update one shared practice and confirm that all
applicable projects discover the update without editing duplicate policy text.

**Acceptance Scenarios**:

1. **Given** a shared practice applies to several projects, **When** Matt updates it, **Then** one authoritative edit changes the guidance for every applicable project.
2. **Given** an agent starts in the repository root or within any app or package, **When** it follows the documented entry instructions for its task, **Then** it discovers both shared guidance and applicable local requirements.
3. **Given** existing instructions disagree, **When** they are consolidated, **Then** reviewers can see their source, scope, and proposed resolution; unresolved conflicts remain explicit and block the affected migration slice.
4. **Given** a rule is specific to Finance, Clipper, or the website, **When** an agent works on a sibling project, **Then** that rule is not presented as universal policy.
5. **Given** an instruction describes a completed phase or an obsolete version, **When** it is reviewed, **Then** current guidance replaces or retires it while historical decisions remain traceable.

---

### User Story 2 - Change a library and its consumers together (Priority: P1)

A maintainer changes shared functionality and updates affected consumers in one
branch and review, without transferring library archives between repositories.

**Why this priority**: UI and Local First already support multiple consumers.
Coordinating their changes is the main development benefit of consolidation.

**Independent Test**: From one clean checkout, make a representative shared change
and verify a consuming app using the documented commands, without preparing or
copying an internal dependency archive.

**Acceptance Scenarios**:

1. **Given** a clean checkout and documented configuration, **When** a maintainer prepares the workspace, **Then** all included projects resolve their internal dependencies from that checkout.
2. **Given** an internal library change, **When** affected consumers are built and checked, **Then** they use the reviewed library revision from the same branch.
3. **Given** a breaking shared change, **When** it is proposed, **Then** its affected consumers are updated or an explicit compatibility path is included before merge.
4. **Given** library packages are intended for external consumption, **When** release readiness is checked, **Then** their packaged public interfaces are verified independently of workspace linking.

---

### User Story 3 - Work on and release projects independently (Priority: P2)

A maintainer develops, checks, and releases one project through clearly documented
commands while shared changes receive the broader verification they require.

**Why this priority**: A shared repository must preserve useful separation between
the website, applications, extension, and libraries.

**Independent Test**: Identify the required checks for an app-only change and a
shared-library change. Exercise each project's existing release or deployment
path in an isolated environment without releasing unrelated projects.

**Acceptance Scenarios**:

1. **Given** an app-only change, **When** checks are selected, **Then** unrelated app checks are excluded unless a documented shared dependency or configuration change requires them.
2. **Given** a shared-library change, **When** checks are selected, **Then** the library and its transitive consumers are included; shared root configuration changes use a conservative documented selection.
3. **Given** one app is ready to release, **When** its release is prepared, **Then** it retains its own configuration, secrets, deployment destination, and rollback path without requiring another app's release.
4. **Given** concurrent development servers, **When** they start, **Then** they use distinct ports, provide network access and discoverable URLs, and preserve existing unidentified servers and user data.
5. **Given** older deployed clients or extension installations, **When** a new project release is prepared, **Then** existing compatibility obligations remain part of that project's release verification.

---

### User Story 4 - Migrate without losing project context (Priority: P2)

Matt reviews migration slices with a clear account of their source revisions,
history, guidance, feature artifacts, integrations, and verification evidence.

**Why this priority**: Moving files must not lose the decisions and operational
context needed to maintain the projects safely.

**Independent Test**: Audit a proposed import against its source inventory. Follow
representative historical changes, specifications, and operating links, and walk
through its documented rollback before accepting the slice.

**Acceptance Scenarios**:

1. **Given** a project import, **When** reviewers inspect it, **Then** its source repository, selected commit, retained history, path mapping, and intentionally excluded material are recorded.
2. **Given** several projects have overlapping feature numbers or active-feature metadata, **When** their artifacts are imported, **Then** each remains uniquely addressable and project-local planning commands select the intended feature.
3. **Given** open branches, PRs, issues, worktrees, and repository integrations, **When** migration is planned, **Then** their disposition is recorded without silently importing unfinished work or claiming that Git history transfers hosting-platform metadata.
4. **Given** a migration slice fails verification, **When** it is stopped or reverted, **Then** the previous maintained source and operational release remain recoverable through documented steps.

### Edge Cases

- An agent starts inside a nested package and misses root guidance, or follows a stale memory-file link.
- Shared instructions conflict with a local exception, an approval requirement, or a current user instruction.
- A source repository's constitution contains domain rules that must not govern sibling projects.
- A vendored library snapshot contains consumer-specific changes absent from the library's selected source revision.
- Apps depend on incompatible versions of a framework or runtime library; migration must not silently force an upgrade.
- A file move changes dependency resolution, generated-file paths, test fixtures, deployment roots, or server-only environment handling.
- A root configuration or lockfile change affects more projects than an app-only file filter detects.
- Spec Kit skills or templates look identical but contain intentional local changes.
- An existing deployed app, offline client, or extension still uses an older library or data contract after the source repositories are consolidated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The maintained repository MUST include the website, Finance, Clipper web app and extension, UI library, and Local First library as separately identifiable projects (Story 2).
- **FR-002**: Maintainers MUST be able to prepare and work on every included project from one checkout using documented prerequisites and commands (Stories 2, 3).
- **FR-003**: Internal library development MUST use the selected workspace sources without manual archive transfer. Replacing an existing snapshot MUST account for any changes absent from the selected library revision (Story 2).
- **FR-004**: UI MUST retain ownership of generic presentation; Local First MUST retain ownership of reusable local-first foundations; applications MUST retain their own schemas, domain policies, and operations. Shared placement MUST NOT permit imports through another project's private implementation (Stories 1, 2).
- **FR-005**: Each project MUST retain discoverable development, build, verification, and release commands. Shared commands MUST compose those commands without requiring a project rewrite (Stories 2, 3).
- **FR-006**: Verification selection MUST cover changed projects and affected consumers, with conservative handling for shared configuration and uncertain dependencies (Story 3).
- **FR-007**: Applications, the extension, and libraries MUST retain independent release identities and release or deployment paths. Their versions and release dates MUST NOT be coupled solely by repository placement (Story 3).
- **FR-008**: Migration MUST preserve existing product behavior, data compatibility, public URLs, package interfaces, and environment separation unless a separately reviewed change explicitly alters one of them (Stories 2–4).
- **FR-009**: Published or externally consumed libraries MUST retain verification of packaged exports in addition to verification through workspace dependencies (Story 2).
- **FR-010**: Shared working agreements MUST have one root entry point. Detailed reusable practices MUST have one authoritative source per topic; local entry points MUST link to applicable shared material and contain only project-specific requirements or explicit exceptions (Story 1).
- **FR-011**: The root entry point MUST provide task-based reading instructions for detailed guidance, including state machines and resource ownership, localization, accessibility, testing, dependencies, and release workflow (Story 1).
- **FR-012**: The guidance model MUST document instruction scope and conflict handling, respect current user instructions and tool-level instruction precedence, and make any project exception explicit. A local file MUST NOT silently weaken an applicable approval requirement (Story 1).
- **FR-013**: Before guidance is replaced, the migration MUST inventory agent entry files, linked memories, constitutions, skills, templates, and scripts across all five source repositories. Each normative rule MUST receive a disposition: shared, local, superseded, or unresolved, with its source and rationale (Stories 1, 4).
- **FR-014**: Conflicting approval gates, testing practices, workflow rules, supported dependency versions, and formatting conventions MUST receive an explicit reviewed resolution before the affected guidance becomes authoritative. Age or repository location MUST NOT decide precedence (Story 1).
- **FR-015**: Identical reusable skills and templates MUST have one maintained copy. Intentional differences MUST be reconciled or retained as scoped variants with a documented reason. Generated tool-specific entry files, if needed, MUST have a documented source and regeneration path (Story 1).
- **FR-016**: Current feature status and version-specific instructions MUST point to maintained project records. Superseded phase restrictions MUST be retired from active guidance without erasing their historical context (Story 1).
- **FR-017**: Guidance maintenance MUST include checks for broken local links, missing required entry points, and drift in any generated entry files. Verification MUST also exercise instruction discovery for all six project contexts (Story 1).
- **FR-018**: A PR that changes a reusable engineering practice MUST update its shared guidance in the same review. A PR introducing a local exception MUST state its scope and rationale (Story 1).
- **FR-019**: Every source import MUST record its repository, selected commit, path mapping, included history, and exclusions. Original commit identities MUST remain traceable without relying on the source repository remaining available indefinitely (Story 4).
- **FR-020**: Existing specifications, decision records, and feature selection MUST remain accessible and unambiguous after migration. Project-local planning workflows MUST NOT overwrite a sibling project's active feature (Story 4).
- **FR-021**: Planning MUST inventory open work and repository-level integrations, including deployment roots and required checks. It MUST document what remains in source repositories, what moves, and how maintainers find retained discussions and links (Story 4).
- **FR-022**: Migration MUST proceed in reviewable slices with recorded baseline checks, acceptance evidence, rollback steps, and a defined point at which each project's maintained source changes (Story 4).
- **FR-023**: The planning phase MUST establish the baseline toolchain and import order from actual compatibility evidence. Different package-level versions MAY remain where supported; consolidation MUST NOT require an unrelated dependency upgrade (Stories 2, 4).
- **FR-024**: Concurrent development MUST preserve project data and existing servers, use distinct available ports, and announce localhost and LAN URLs when available (Story 3).
- **FR-025**: Application and library verification appropriate to each migration slice MUST pass before that slice is accepted. Existing implementation-review and testing-approval gates MUST remain effective until their reconciliation is explicitly approved (Stories 1–4).

### Agreed Scope and Constraints

- Use `delightful-labs/delightful-labs` as the destination, retaining the website as a distinct app within it. The source set is the existing website plus Delightful Finance, Clipper, UI, and Local First repositories.
- Start with **pnpm workspaces without Nx**. Additional task orchestration, caching infrastructure, or generator systems require evidence of a concrete need and separate review.
- The proposed organization is `apps/website`, `apps/finance`, `apps/clipper-web`, `apps/clipper-extension`, `packages/ui`, and `packages/local-first`. Planning must validate these paths against build and deployment behavior before adopting them.
- Preserve each project's existing hosting platform and package interfaces. Consolidation does not select one host or one release schedule for all projects.
- Root guidance covers shared working agreements, linked topic guides cover reusable practices, and scoped entry files cover local requirements. Topic paths and the treatment of existing memory directories are planning decisions.
- This PR establishes a draft specification and its active-feature selection only. It does not import repositories, move the website, install dependencies, change live agent policy, or initiate deployment.
- The existing website specification remains available at [Homepage and Native Open Thoughts](../../apps/website/specs/001-homepage-native-blog/spec.md). This feature supersedes its exclusion of unrelated repository imports only for this separately reviewed migration; the website's product, content, typography, and publishing constraints continue to apply to the website.

### Key Entities

- **Project**: An app or library with an owner boundary, dependencies, commands, configuration, and release identity.
- **Source Inventory**: A source repository and selected revision, its source-to-destination mapping, historical references, integrations, and outstanding work.
- **Guidance Rule**: A normative instruction with provenance, applicable scope, authoritative location, and reconciliation disposition.
- **Migration Slice**: A reviewable move or consolidation with prerequisites, baseline evidence, acceptance evidence, and rollback steps.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All six project contexts can be prepared and built from one clean checkout using documented configuration, with zero manual internal archive-copy steps.
- **SC-002**: A representative shared-library change and its consumer updates can be reviewed together in one PR and verified against the same source revision.
- **SC-003**: For one representative task in each of the six contexts, following the guidance entry path identifies all applicable shared and local instructions, with zero unresolved rule conflicts in accepted migration slices.
- **SC-004**: One reusable practice can be updated through one authoritative edit and is discoverable from every applicable project without editing duplicate policy text.
- **SC-005**: Every normative rule in the five-source guidance inventory has a recorded disposition and provenance; every retained local exception has an explicit scope and rationale.
- **SC-006**: The verification-selection review includes an app-only change, a shared-library change, and a shared-configuration change; all required consumers are included and unrelated checks have a documented reason when included.
- **SC-007**: Every existing release or deployment path has recorded isolated verification and rollback evidence, with no mandatory release of unrelated projects and no migration-induced change to public addresses or data contracts.
- **SC-008**: Every source project has a reviewed history and artifact mapping; representative historical commits, specifications, and active-feature selections can be located from the consolidated checkout.
- **SC-009**: Required guidance entry files and their local links pass validation, and any generated guidance reproduces without unreviewed drift.

## Assumptions

- Existing maintainers and coding agents are the users of this feature. It introduces no new application-facing behavior or copy.
- The five repositories share enough tooling for a workspace, but their exact revisions, dependency constraints, and vendored snapshot differences must be inventoried before implementation. Current local checkouts are research inputs, not automatically approved import baselines.
- The initial dependency direction is UI to its consumers, with Local First consumed by Finance and Clipper; the website currently consumes UI. Planning must verify actual package dependencies and their transitive effects.
- Histories and project discussions are valuable. The exact history-import mechanism and disposition of old repositories remain planning work; this feature does not authorize archival or deletion.
- The destination's current default branch is `master`. Branch renaming, repository settings, and required-check changes are separate administrative decisions.
- This draft uses its own active feature in the destination repository. Planning must establish separate project feature selection for the imported workflows before they are consolidated.

## Planning Decisions Required

1. Inventory all five sources at explicit commits, including vendored snapshots, unpublished library changes, outstanding PRs, workflows, release destinations, and histories to retain.
2. Validate the proposed project paths and internal package boundaries, then select the smallest compatible workspace toolchain and import sequence.
3. Produce the guidance-rule inventory and proposed shared/local/superseded mapping. Reconcile approval gates, state-machine versions, testing conventions, and localization systems without silently broadening their scope.
4. Establish task-specific guidance discovery from both root and nested working directories, shared skill discovery, and unambiguous per-project specification state.
5. Define verification selection, existing-command mapping, packed-library checks, and preview or isolated release evidence for each project. Establish a conservative fallback for root configuration changes.
6. Record migration slices, release continuity, retained discussion links, source-of-truth handoff, and rollback before changing any maintained source or hosting configuration.

## Out of Scope

- Executing the migration or rewriting effective agent guidance in this specification PR.
- Adding Nx or another task orchestrator, remote caching, or a new deployment platform to the initial migration.
- Product redesign, typography work, new localization strings, domain extraction beyond existing library boundaries, or opportunistic framework and dependency upgrades.
- Moving live databases, identities, stored user content, or published blog records.
- Merging open source-project work automatically, forcing a single package version, or requiring simultaneous production releases.
- Renaming the default branch, changing repository access or protection, transferring hosting resources, or archiving/deleting source repositories without separate authorization.
