# Evidence and investigation brief

**Captured**: 2026-11-16  
**Status**: Initial observations; causal diagnosis and prospective savings pending

## Recorded baseline

Vercel billing exports inspected in this session covered daily charge periods
starting 2026-11-10 at 08:00 UTC through the partially accrued period starting
2026-11-16 at 08:00 UTC. The current period and billing reports can lag; these
figures are a historical snapshot, not a complete invoice or monthly forecast.
Effective usage cost excluding subscription licenses was approximately $15.86:

| Category | Effective usage cost |
| --- | ---: |
| Build CPU | $9.21 |
| Sandbox CPU, memory, drives, snapshots and other sandbox usage | $3.47 |
| Function CPU, memory, invocations and origin transfer | $2.46 |
| Function/deployment storage | $0.63 |
| Remaining categories | $0.08 |

Rounded categories may not sum to the precise total. Included credit consumption
and final invoiced overage are different from effective resource cost. Reconcile
the original records and complete windows before making a future billing claim.

Deployment history since November 10 contained 439 attempts, including 345
previews and 94 production attempts; 353 reached Ready. Attempts include canceled
builds and are not a count of fully billed builds. Many commits triggered Clipper,
Finance and website deployments together. PR #43 added app scoping; PR #44 adds
test/tooling exclusions. Measure subsequent savings rather than extrapolating
the historical build total to every future week.

## Runtime observations and uncertainties

### Hosted deployment-filter finding

The spec-only commit `3f800029` skipped Clipper and the website but built Finance
in deployment `dpl_AZfDgBvMrygZT993sYw8TUZ1TZ3u`. Its build log shows that
Finance's `.vercelignore` removed `.git/HEAD`, `.git/config`, and other metadata
before running the ignore command. Git then reported that no repository was
available, so the command continued via its missing-comparison fallback. This is
a confirmed Finance configuration defect, not a Markdown classification failure.
The PR correction retains that metadata while preserving local secret exclusions;
a subsequent hosted documentation-only comparison still needs qualification.

### Jazz observations

- Finance's error summary reported 71 occurrences of requests reaching the
  300-second function limit on `/jazz/[...path]`. The response's first/last-seen
  dates span November 11–16 despite a requested recent window; do not call this
  a verified daily failure rate. A sampled log identified a production stream.
- Finance's sampled production sandbox sessions used 1 CPU and 2 GB memory and
  several lasted roughly 2–3 minutes before another session appeared. Samples
  alone do not establish why sessions ended or how much startup was redundant.
- Both app integrations configure a 60-second Jazz idle window. The pinned Jazz
  adapter intentionally keeps compute awake for sockets or recent activity.
  This behavior can be correct while still incurring memory charges.
- Clipper error summaries reported disconnected migration histories that refused
  store initialization. Determine the exact affected deployments/environments
  and supported store histories; the aggregate does not establish that every
  current production request fails or quantify its cost.

Potential explanations to test include duplicate/unreleased connection owners,
normal long-lived sync expiration, reconnect/startup churn, server lifecycle
limits, and deterministic schema failures. None is established as the sole cause.
Increasing duration, shortening idle time, or resetting a store is not a diagnosis.

## Investigation order

1. Inventory current deployment/environment versions and supported store histories;
   classify failures and preserve data before designing migration remediation.
2. Establish matched no-client/active/background/multi-tab/extension baselines.
   Correlate stream endings, client reconnects, sandbox starts/stops, and resource
   usage using sanitized existing diagnostics. Limit any paid qualification run.
3. Select and review owned connection/cleanup behavior using supported capabilities;
   qualify offline durability, permission replacement, expiry and recovery.
4. Verify hosted deployment filtering, then evaluate preview policy, build sizing,
   and caching with measured cost/latency. Check the actual current machine;
   do not assume a Turbo default is the cause.
5. Present budget/alert options and continuing-charge/outage semantics for owner
   approval. Only evaluate another backend host if measured economics justify it.

## Platform references

Recheck current documentation and the pinned SDK before technical planning.

- [Function pricing](https://vercel.com/docs/functions/usage-and-pricing): memory
  remains billable while requests wait for I/O; CPU and memory costs differ.
- [Sandbox pricing](https://vercel.com/docs/sandbox/pricing): memory is based on
  allocation and runtime, including idle time, with lifecycle billing increments.
- [Spend Management](https://vercel.com/docs/spend-management): budgets may alert
  or pause production; enforcement is delayed, storage can continue charging,
  and pausing production does not stop every billable resource.
- [Monorepo deployment selection](https://vercel.com/docs/monorepos): automatic
  package-graph skipping and ignored build steps have different requirements.

## Planning handoff

The next technical plan must identify the actual client/server resource owners,
supported expiration and cancellation behavior, retry classification, and data
compatibility obligations. Record evidence-based thresholds rather than invented
retry counts or unsupported SDK configuration. Preserve one SDK owner and each
app's existing identity, tenancy, worker, provider-secret and backup requirements.
Do not begin runtime implementation from this research note alone.
