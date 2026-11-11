# Disposable Jazz databases for Netlify Deploy Previews

## Requirement and plan

Every automatic Deploy Preview gets a newly generated Jazz Cloud app, fresh data, and an independent
schema/permissions history. Keep the implementation on `feature/environment-debug-logging` and its
existing PR. Production continues using its configured, claimed Jazz app.

This is a workflow under the mandatory machine-first gate: validating the deployment context,
provisioning an app, publishing its schema, and building the frontend are independently meaningful
steps with separate failure boundaries. Implement the statechart before the platform adapters:

`checkingContext -> provisioning -> waitingForApp <-> routingDelay -> deploying -> building -> succeeded`

- A non-Deploy-Preview context is `refused`, before any network call or child process.
- Provisioning failure is `failed`; do not automatically retry an app-creation POST.
- Readiness/deployment/build failure is `partial`: a disposable app may already exist. Do not fall back to
  shared credentials or build against an unpublished schema.
- Cancellation enters `cancelled`, aborts the current fetch or terminates the current child process
  group, and lets that process settle before Node exits. Clear credentials in terminal states and
  immediately after schema deployment. No raw error, API response, or admin credential is logged.
- There is no documented deletion operation in this flow. Failed/cancelled builds can leave an
  unclaimed app, which Jazz deletes after 14 days. Successfully deployed previews also expire after
  14 days; rebuild the preview to provision a fresh backend.

The root build entry binds leaf adapters for one provision request, one authenticated readiness request, one Jazz deployment command,
and one frontend build command. The machine owns sequencing; promise actors do not hide additional
workflow decisions. Provision-response validation and child-process shutdown are boundary handling.
The build entry does not attach Stately inspection or dump snapshots containing credentials.

Use the documented endpoint `POST https://v2.dashboard.jazz.tools/api/apps/generate` and the installed
Jazz CLI. Pin the public and CLI app/server variables to the newly created app, overriding inherited
preview settings. Keep the generated admin secret in memory for readiness checks and in the schema-deploy child's
private environment only; remove inherited admin/backend credentials from the frontend build environment.
No credentials are written to `.env`, committed, cached, or included in command arguments.

Sources: [Jazz server setup](https://jazz.tools/docs/getting-started/server-setup),
[Netlify deploy contexts](https://docs.netlify.com/build/configure-builds/file-based-configuration/).
Netlify MCP's context tool returned `Authentication required`; existing documented configuration and
local files provide the necessary context for this change.

## Review and verification

- [x] Implement the machine, build entry, package command and Deploy Preview context.
- [x] User approved testing the implementation.
- [x] Unit-test context refusal, stage ordering and environment binding, malformed
      responses, provisioning/deploy/build failures, cancellation and terminal secret cleanup.
- [x] Exercise the build entry with isolated process/network fixtures; verify no
      inherited or generated admin secret enters the frontend process or captured output.
- [x] Verify one real disposable hosted app/schema/build in the isolated checkout,
      including generated bundle settings and a preview browser startup. Do not use production data.

No existing application actors, schemas, permissions or browser persistence behavior change. Existing
application browser fixtures should remain unchanged; focused build-workflow tests are the primary
regression coverage. Formatting/static checks are separate from runtime verification.

Implementation review: all four promise actors delegate one operation. Provisioning validates one
HTTP response; deployment and frontend build each own one process group. Each active phase has a
`running`/`cancelling` substate; cancellation aborts its resource without exiting the invocation,
and only proceeds to the terminal state after completion/error confirms settlement. A late success
while cancelling cannot publish schema or start the next process. Native process kill/escalation is
kept in the platform adapter. Generated credentials are cleared before invoking the frontend build
and on deployment failure/cancellation. No browser inspection is attached to this CLI machine.

Verification: 28 focused unit/process tests passed across `jazz-preview-build.test.ts` and
`netlify-preview.test.ts`. Application and test type checks passed, as did formatting and diff checks.
The actual preview command provisioned a fresh Jazz Cloud app, deployed the real schema/permissions,
and completed a production frontend build. Two production browser checks passed, including workspace
bootstrap and account creation against that hosted app. The compiled public settings contain the
new app ID. No actual Netlify deploy was triggered; that platform check follows a push to the PR.

The first live attempt caught a cloud propagation race: a generated app's authenticated catalogue
routes initially return 404; a bounded diagnostic probe observed the permissions head become
`200 {"head":null}` about 15 seconds later. The implementation now checks readiness before deploying.
Readiness is a leaf HTTP operation: 404/502/503/504 and cold-start timeouts return `pending`; the
machine owns the five-second pause, retry counter (maximum 12), cancellation and eventual failure.
Non-transient HTTP failures stop the build. Cancellation waits for an active request/process to
settle and does not issue another operation. No app-creation retry was added. A second live attempt
exposed a cold-start request timeout; regression coverage now exercises that boundary with the
actual Node entry and AbortSignal timeout. The corrected live flow passed end to end.

Diagnostic/failed builds left disposable unclaimed apps, which expire automatically. No production
app or the user's development server/data was changed. Run the hosted browser smoke only after the
real preview build, with `PUBLIC_DEBUG=true DEBUG_PRODUCTION_SMOKE=true
JAZZ_HOSTED_PREVIEW_SMOKE=true pnpm exec playwright test --config playwright.debug.config.ts`.
The opt-in test is skipped during normal debug runs and creates data only in the newly built app.

## PR #33 readiness investigation (2026-10-30)

Netlify CLI logs show two consecutive previews provisioning successfully, then exhausting all 12
readiness checks without reaching schema deployment or the frontend build. Historical logs do not
record the pending HTTP status. The documented Cloud URL matches the configured URL, and a newly
generated disposable app returned HTTP 200 from both permissions head (`head: null`) and schemas
(empty catalogue). Provisioning returns appId, adminSecret, backendSecret and expiresAt, with no
regional URL or readiness metadata. An unknown app returns HTTP 404; 404 alone therefore cannot
establish a propagation delay. The earlier successful Netlify deploy used the production build path.

Add safe HTTP status/elapsed-time logging and static timeout/request-failure messages to the existing
readiness leaf adapter. Preserve the machine's retry, cancellation and failure policy. Do not log
response bodies, credentials, raw exceptions or request headers. No workflow states or actor contracts
change; the adapter still makes one request per invocation. The underlying historical Cloud failure
remains unconfirmed, so do not increase the retry window on this evidence.

Pending implementation review: extend the process-fixture assertions in
`src/lib/testing/deployment/netlify-preview.test.ts` for HTTP status, timeout and secret-safe failure
output. Existing machine tests retain the unchanged 12-attempt boundary; browser fixtures are
unaffected. No tests have been added or run for this diagnostic change.
