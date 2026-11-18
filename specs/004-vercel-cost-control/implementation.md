# Vercel cost controls: completion and remaining work

**Last reconciled**: 2026-11-16 (America/New_York), through main `6c8f8339`

**Scope**: Cost attribution, deployment selection, dependency installation and
spending alerts. The separate Jazz agent owns upgrades and runtime remediation;
this record does not declare those stories complete.

## Released controls

| Change | Release | Verification |
| --- | --- | --- |
| Unaffected-app and Markdown filtering | [PR #43](https://github.com/delightful-labs/delightful-labs/pull/43), merge `c66d915d` | Shared selection preserves affected consumers and skips before dependency installation |
| Test/recognized-tooling exclusions and Finance Git metadata retention | [PR #44](https://github.com/delightful-labs/delightful-labs/pull/44), merge `5724d3f2` | Test/tooling changes retain CI; Finance upload rules retain Git comparison metadata |
| First-preview comparison and Website scoped install | [PR #45](https://github.com/delightful-labs/delightful-labs/pull/45), merge `5e78a349` | Native no-origin/shallow-Git replay, live first-preview trial, green CI and production verification |
| Finance and Clipper scoped installs | [PR #47](https://github.com/delightful-labs/delightful-labs/pull/47), merge `6c8f8339` | Clean/warm installation, equivalent output, green full CI, Ready previews and production builds |
| Team overage alert budget | Owner-authorized hosted setting | Changed from $200 to $1 and independently inspected; alert-only, no automatic pause |

The owner authorized implementation/testing and continued publication within
this task, approved the website install and budget with “Go ahead with both,”
and merged PRs #45 and #47. These changes did not alter SDK/dependency versions,
lockfile, application behavior, or the existing full development/CI install.

## Deployment selection and the first-preview correction

The [shared release guide](../../docs/engineering/releases.md#check-selection)
owns the exact policy. Markdown, tests, recognized verification/editor settings
and unaffected applications skip before installation. Runtime, production build
configuration, dependencies and unknown inputs retain conservative coverage.
Renames, deletions and intervening skipped commits remain part of the comparison.

Initial PR #45 previews still built every app on a new branch. Local tests had
missed Vercel's reconstructed Git shape: only a master ref and no origin remote.
A later live diagnostic exposed that mismatch; the owned verification builds
were canceled. The final correction uses fetched main's unique merge base for a
known first Preview branch, including the full branch delta. Validated public
GitHub metadata supplies the source URL when origin is absent. Failed or ambiguous
comparisons remain conservative, bounded by a 15-second comparison budget.
Only the three exact deployment-control modules are excluded from app artifact
inputs; their changes still select the existing CI suites.

All 23 tooling/guidance checks passed. A native regression recreated the observed
no-origin/master-only checkout. A live trial on `44836b21`, using normal ignored
build commands and no successful previous deployment, produced:

| Project | Deployment | Result |
| --- | --- | --- |
| Website | `dpl_4tDQzXcoYqo8ExvnTUwWVdnLkDt4` | Ready; Website/UI installed |
| Finance | `dpl_GpAKoTPapA8gr4tsf54E1MZ1EGxo` | Ignore exit 0; no installation |
| Clipper | `dpl_47AUQyGH2P6opDmZpaJuQSqemQhH` | Ignore exit 0; no installation |

These were observed hosted decisions, not only replayed fixtures. Vercel can
still display canceled attempts; cancellation does not prove zero resource cost.

## Scoped installation qualification

| App | Configured command | Workspace packages retained |
| --- | --- | --- |
| Website | `pnpm --filter 'delightful-labs...' install --frozen-lockfile` | Website, UI (2 of 8) |
| Finance | `pnpm --filter 'delightful-finances...' install --frozen-lockfile` | Finance, Local First, UI (3 of 8) |
| Clipper | `pnpm --filter '@delightful-clipper/web...' --filter delightful-clipper install --frozen-lockfile` | Web, coordinator, Local First, UI (4 of 8) |

Qualification used isolated checkouts, their own dependencies/generated files,
Node 24.22.2 and pnpm 10.28.0. No user server or production data was reused.
Required UI exports, generated localization, Local First exports and injected
peer identities were checked. Clipper includes the coordinator so its existing
preinstall vendor verification remains authoritative; the hosted log confirms
verification of all eight vendor archives.

Website type checks, 152 unit tests, build, emitted SSR route checks and seven
Chromium tests passed. Finance's scoped type checks and both apps' Vercel builds
passed. Clipper's web type checker also includes extension test fixtures: it
requires the existing full CI installation, under which it passed. The production
install intentionally excludes extension dependencies; no checks were weakened.
All required PR workflows passed before release, including Finance and Clipper's
full qualification suites.

Scoped and full builds were compared in the same checkout path to avoid
path-dependent Svelte CSS hashes. All file/symlink entries matched after
normalizing only SvelteKit's generated version and its exact derived global name:

| App | Matching output entries |
| --- | ---: |
| Website | 1,158 |
| Finance | 1,847 |
| Clipper | 3,450 |

No application assets, routes or dependencies were excluded from comparison.
One local warm-install pair showed modest improvement, particularly for Clipper;
it is not a controlled Vercel billing comparison or a dollar-saving claim.

### Production verification after merge

PR #45, merge `5e78a349`:

| Project | Production deployment | Result |
| --- | --- | --- |
| Website | `dpl_7hSeeRijZhZiH7zqXGJstizbgTnT` | Ready; 2-of-8 install, 7.8 seconds |
| Finance | `dpl_FeKspcUyE3NwCav66F77zaabh58U` | Unaffected; canceled before installation |
| Clipper | `dpl_5j33x7abMGboPzMm5TTQPKHfkFnM` | Unaffected; canceled before installation |

PR #47, merge `6c8f8339`:

| Project | Production deployment | Result |
| --- | --- | --- |
| Finance | `dpl_WoqfZvJZjbd9xSz3Yc8MzRXNpAUG` | Ready; 3-of-8 install |
| Clipper | `dpl_DMFPDyyYJqGLhpjEG6kHFyhHmb6f` | Ready; 4-of-8 install and vendor verification |
| Website | `dpl_3Ag29ZgXijiMTFreRvkHgtPht1yc` | Canceled immediately; API reason confirms the commit did not affect the project; no install/build events |

PR #47 previews also reached Ready: Finance `dpl_AyWKafYRLjd3TmLS2Ew45rhpMjN8`
installed in 33.2 seconds; Clipper `dpl_RoxYg8FJDKxqdqzWcocVkqV9bPjK` in 40.9
seconds. These are observations, not matched before/after savings measurements.

## Applied budget

The authenticated CLI 65.15.0 was scoped to `mjamesderochers-projects`. The team
budget was read immediately before the update and independently inspected after:

| Setting | Verified result |
| --- | --- |
| Basis | Team on-demand usage after included Pro credit |
| Amount | $1, previously $200 |
| Notifications | 50%, 75%, 100%: $0.50, $0.75, $1 of overage |
| Automatic pause | Disabled at every threshold |
| Webhooks | Disabled |
| On-demand spend at that inspection | $0 |

Saved notification settings were verified; delivery was not forced or proven.
This is an alert, not a hard cap. Project/product budgets were not enabled.

## Remaining work, in order

1. **Measure savings and forecast.** Collect complete post-release billing days
   after ingestion catches up. Compare project/resource costs with the historical
   baseline, recording build counts, build CPU per completed build, development
   activity and deployment timestamps. Separate runtime and build changes; the
   concurrent Jazz upgrade prevents attributing every change to this work.
   Record active hours/device mix before forecasting against the $20 credit.
   SC-001, SC-006 and SC-007 remain open.
2. **Coordinate runtime acceptance with the Jazz owner.** Stories 2 and 3 remain
   unqualified here: idle/no-client, active/background/multiple-tab/extension,
   reconnect/offline recovery, supported store histories and compatible rollback.
   Upgrade availability or fewer errors alone cannot satisfy SC-002–SC-004.
3. **Optional earlier project alerts.** Proposed Finance $8, Clipper $8 and Website
   $2 thresholds would warn before shared credit is exhausted. They are unapplied;
   review current spend, notification behavior and owner approval before enabling.
4. **Lower-priority preview retention.** Historical deployment/function storage
   was about $0.64 in the captured window. Inventory aliases, active previews and
   rollback builds before proposing shorter preview retention. Production recovery
   artifacts and data remain protected; no retention/deletion changes were made.
5. **Measure before further build-setting changes.** Cache reuse is already
   observed. Machine size/concurrency changes, disabling affected previews, another
   host and paid monitoring have no demonstrated saving and were not selected.

The latest historical project capture was about $16.52 of effective resource
usage, including $9.76 build CPU (about 59%) and $0.64 deployment/function storage;
$4.67 of prorated subscription was separate. It covered November 10 at 08:00 UTC
through the partially accrued period ending November 17 at 08:00 UTC, captured
November 16 at 22:35 UTC. It did not separate preview from production. A separate
daily export totaled $16.5171, $0.0028 lower; timing is possible but unproven.
The earlier research snapshot of about $15.86 remains historical, not contradicted
by a later capture. Neither capture is a complete invoice or monthly forecast.

Reproduce the attributed billing read with explicit scope and label capture time
and incomplete periods; do not sum sampled/truncated connector records:

```sh
vercel --scope mjamesderochers-projects billing usage \
  --since 2026-11-10T08:00:00Z --until 2026-11-17T08:00:00Z \
  --group-by project --json --non-interactive
```

Only the alert configuration and released deployment/install controls are complete.
Measured recurring savings, runtime acceptance and the monthly forecast remain open.
