# Shared guidance and CI selection

User authorization: continue the shared-guidance/CI slice on 2026-11-11. The user
explicitly requires the Conventional Commits title check for **every PR**.
The user then explicitly instructed that the stricter engineering rules apply
to every project. Shared approval, copy/catalog, type-safety, test-review and
resource-ownership requirements therefore use that stricter baseline. Existing
task-specific authorizations remain scoped; no approval is inferred from silence. Existing migration/test authorization
remains scoped to the active migration session.

Before replacing instructions, `guidance-disposition.json` records the baseline
commit, hashes and each maintained Markdown instruction/context block. Unchanged
constitutions, SDK/domain memories, templates and specifications stay scoped.
Shared guides consolidate common engineering intent; local entries link to them
and retain explicit local requirements. Different localization placement and formatters stay explicit. Stricter worker,
approval and public-copy requirements apply across all projects.
No constitution becomes global, and document age does not choose precedence.

Ten identical Spec Kit skills in Finance and Local First now link to the existing
root copies after byte equality is verified. Helpers/templates already share
root copies; feature selectors remain independent. Generic state/resource
ownership moves to one shared guide; project-specific facts and pinned-version
extensions remain in local memories. Historical v5 syntax is not current API
instruction. Current active specs/qualification records own feature status.

CI routing uses the workspace dependency graph: UI affects all consumers;
Local First affects Finance and both Clipper apps; website and Finance changes
stay scoped; Clipper web/extension checks run together because source and native
fixtures cross that boundary. Root/unknown/config/guidance changes or missing
history select all. Renames inspect both paths. Manual runs select all.

Existing workflow triggers/check names remain; job conditions select work. Each
workflow always emits its planning result, avoiding workflow-level path filters
that can leave required checks pending. No hosted required checks/rulesets change.
See [GitHub job conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions)
and [skipping workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs).
PR titles are parsed as event JSON, never interpolated into shell source; see
[GitHub script-injection guidance](https://docs.github.com/en/actions/concepts/security/script-injections).

Verification covers dependency closure, unknown/missing history, deleted and
renamed paths, all-PR titles (including shell-looking data), local instruction
links, shared skill drift and discovery in all six product contexts. Read-only
feature discovery must preserve every sibling selector. Application code,
localization catalogs, data and hosted settings are outside this slice.

## Completed policy resolution

The user's stricter-all instruction resolves the formerly local approval/test
scope: implementation review before tests, exact copy/catalog/config/generated
output approval, dependency/visual approval, strict new-code typing (including no
assertions, switch/case or application classes), UI semantic testing and worker
ownership now apply throughout the workspace. Existing task-specific user approvals
retain precedence and scope. Finance/Local First domain constitutions remain
local. Formatting tools and descriptor-versus-rendered-text localization remain
explicit project contracts, not exceptions to shared approval or workflow ownership.
This slice changes no translation architecture.

Root AGENTS.md links seven canonical topic guides. Local entries retain product,
SDK/schema, platform and qualified-version details. Repeated generic workflow
memory moves to the root guide; obsolete v5/phase/tuple-assertion allowances are
retired. The disposition ledger retains 66 baseline files and 4,983 source
instruction/context blocks (2,269 unique blocks) against commit
`03f1d70d52baa47a804068e0030d376dc9af9d37`. Every source hash was checked against
its original Git object. Both sets of ten skills were byte-compared before linking
to their root owner. No inherited ratified constitution was edited or globalized.
The UI README's stale Drawer specification anchor was repaired during link audit.

## Verification and limits

Node 24.22.2 / pnpm 10.28.0:

- `pnpm monorepo:test-tooling`: 12 tests pass. Scenarios include dependency
  closure, multi-app changes, root/unknown paths, manual/zero/missing history,
  real Git moves/deletions/newline filenames, divergent pushes, invalid refs,
  valid/invalid titles and shell-looking JSON data, workflow selection wiring,
  missing links/anchors, nested instructions, missing entries, shared-tool drift
  project-scoped features and inherited feature overrides without persistence.
- `pnpm monorepo:check-guidance`: maintained guidance links/anchors, entry chains,
  shared helper/template/skill ownership, disposition targets and all six actual
  Spec Kit helper discoveries pass. All five feature selectors remain byte-identical.
- All four root workflow files parse successfully using the already installed
  YAML parser. `git diff --check` passes. No new dependencies or lock changes.

PR comparisons use merge-base differences; pushes compare the actual before/after
commit trees so divergent history does not drop removed scopes. Names are NUL
separated and rename collapsing is disabled. Invalid/missing history selects all.
Each workflow plans from a full checkout; existing check names/suites remain.
Planning failure fails existing jobs before setup rather than yielding green skips.
The title workflow has no project, path or draft filter and handles title edits.

These are local tests and workflow parses, not hosted Actions execution or hosted
ruleset enforcement. Application/browser suites were not rerun for this docs/CI
slice. Source upstream reconciliation, three existing Clipper extension failures,
hosted previews/settings and source cutover remain separate outstanding work.
Rollback this slice by reverting its guidance/tooling/workflow commit; no source
checkout, hosted setting, product data or production artifact changed.
