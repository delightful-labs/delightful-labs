# Testing and agent server memory

These are user-approved working preferences from the CI and browser-test cleanup. Apply them to
both unit tests and end-to-end tests. The constitution and implementation-review requirements
remain authoritative.

## Inspect and update tests before running them

- Every implementation change needs an explicit assessment of the affected tests. Search for
  direct coverage and callers, shared fixtures, helpers, and assertions that depend on the changed
  behavior. Identify this impact during implementation review, rather than waiting for failures.
- Read the relevant implementation and tests together. After implementation approval, update the
  affected tests before executing them. Apply this to unit and Playwright coverage, including
  parameterized cases and other suites that share the changed contract.
- Check unit-test inputs, mocks, return values, machine events/states, validation expectations,
  and persistence outcomes against the current implementation.
- Check e2e fixtures against current schemas and permissions. Inspect routes and inherited query
  parameters, accessible roles/names, input values versus rendered text, disclosure state,
  workspace-switch behavior, redirects, and local versus remote persistence expectations.
- Follow the approved behavior in the spec. Do not weaken assertions or change fixtures merely
  to conceal an application defect. Preserve the scenario's intent and fix production code when
  the implementation is wrong.
- Static inspection complements execution. Run the smallest relevant checks after correcting
  the issues visible in code; do not launch a broad suite simply to discover stale expectations.
- For local-first startup changes, cover a cold restart with every app client closed and an online
  connection that opens but never answers, as well as browser offline mode. Check available local
  data and writes, partial replicas, observed access changes, and later rejection or recovery.
  A warm tab or browser online status does not prove cold-start availability or remote acceptance.
  Expand verification when shared behavior changed or evidence justifies it.
- On failure, inspect the error, page snapshot, fixture, and implementation before the next
  attempt. Avoid blind retries and longer timeouts as substitutes for diagnosis. Track any
  user-specified retry limit per test and stop/report when it is reached.

## Reuse disposable agent servers

- When the user's development server is running, run preparation, type checks, unit tests,
  builds and agent browser servers in a separate checkout with its own `node_modules` and generated
  files. A different app port and in-memory Jazz server do not isolate SvelteKit's generated
  development environment modules. Do not symlink the running checkout's `node_modules`: Vite caches
  and framework-generated dependency files must also be isolated. Verification once overwrote the
  running frontend's Jazz URL with a stopped test server and left workspace preparation waiting.
- The protected environment is the user's `pnpm dev` server: app port 5173 and Jazz port 5174.
  Do not stop it, clear its browser storage, or modify/reset its Jazz data for agent tests.
- Keeping an agent server running is allowed and preferred for successive focused test runs.
  Start `pnpm dev:agent --host 127.0.0.1 --port 5182` (or another available agent port), announce
  its URL, and reuse that server. Its Jazz storage must remain disposable and in memory.
- Match Playwright's base URL and server URL to the agent port. For an explicitly started,
  known agent server, use `reuseExistingServer: true` or the equivalent external-server setup.
  Use isolated browser contexts and fixtures; avoid paying server startup and compilation costs
  for every individual test.
- Reuse only servers known to belong to the agent session. If a port is occupied by an unknown
  process, choose another port instead of killing it. Distinct concurrent agent sessions need
  distinct app ports and disposable Jazz services.
- A sandbox denial when binding a local server is an environment/startup failure, not a failing
  test. Use the available permission mechanism for the authorized local-server operation; do not
  repeatedly retry unchanged tests in a sandbox that cannot start their server.

## Missing dependencies

- Missing `node_modules` is not a reason to skip checks or tests. Install the lockfile-pinned dependencies with `pnpm install --frozen-lockfile`, then continue with the relevant checks and tests. Report only a concrete installation failure as a blocker.
