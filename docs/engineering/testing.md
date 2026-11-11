# Testing and review

The stricter imported review/test rules apply to every project by the user's
2026-11-11 instruction. Identify affected tests while implementing. Do not add
or run implementation tests until the user has reviewed and approved the
implementation they cover. Current task-specific authorization persists within
its actual scope; record explicit authorization rather than inventing a permanent
exception. A general feature request does not authorize new catalogs or wording.
See [scope and approvals](scope.md).

Work one focused task at a time. Keep review batches small (normally 4–6 related
implementation files), and change at most one route/component per review cycle
unless the user authorizes a larger batch. Show the completed change before
starting unrelated work. Do not broaden a migration into product refactoring.

Before running affected coverage, inspect implementation, callers, shared
fixtures, schemas, actor inputs/events/reports, accessible names and UI assertions.
Update drift by understanding the contract, not by repeatedly running tests or
weakening assertions. Use the smallest meaningful checks, then broaden only for
shared changes, failures or unresolved concerns. Required checks must pass;
static types and extracted-helper tests do not establish native/race correctness.

Test user-observable behavior, native HTML state, accessibility, focus, visibility,
bounds and scrolling. Use role/label/text/native attributes; stable test IDs are
appropriate when no semantic locator fits. Do not assert computed/inline CSS,
CSS class membership or select components by styling classes. Styles may set up
a scenario. Screenshot/source-artifact comparisons can verify a documented
compatibility boundary without replacing behavior tests. Do not mirror production
implementation in an expected model or fixture.

State-machine tests use independent behavioral oracles and real actor/adapters.
Preserve typed initialization/observation inputs, scope/generation correlation,
rejection before effects, cancellation/drain/rollback and uncertain outcomes.
Use the project's pinned generated-testing tooling and bounds/seeds/coverage;
retain shrunk replay artifacts and native browser/Jazz/worker coverage. A
scheduler proves only its instrumented interleavings, not all platform races.

Local-first changes need full browser-process restart with app/auth/Jazz endpoints
unreachable, retained local edits through another restart, and reconciliation.
Also test a connection that opens without answering, partial replicas and later
permission rejection. Existing/restored identities and expired credentials are
separate cases; a warm tab or fresh empty identity is insufficient.

## Isolated environments

Preserve user servers, browser storage, credentials and native data. When a user
server exists, use a separate checkout with separate node_modules and generated
files. Do not symlink its node_modules. A distinct port does not isolate Vite or
SvelteKit generation. Finish checks/builds before browser runs within the same
project; concurrent generation can replace a server's environment modules.

Use disposable test authorities/profiles and app-specific agent commands. Reuse
only a server explicitly known to belong to the agent, with matching base URL,
port and reuse settings. Keep concurrent ports distinct and preserve unidentified
listeners. Finance's user app/Jazz ports 5173/5174 are specifically protected;
use its in-memory `dev:agent` setup. All user-facing servers require a named tmux window. Announce localhost/LAN URLs and bind development servers to
0.0.0.0; isolated test fixtures retain their explicit local origins.

Inspect failures, fixture state, error context and implementation before retrying.
Do not replace diagnosis with timeouts, blind retries or weakened assertions.
Respect user retry limits. A denied listener/browser startup is an environment
failure; use the permission mechanism rather than calling it a failed app test.
Missing dependencies require a frozen install, not skipped coverage.
