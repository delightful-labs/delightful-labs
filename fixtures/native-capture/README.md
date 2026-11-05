# Native Jazz capture experiment

Hypothesis: Jazz 2's native exclusive-transaction snapshot can replace consumer writer gating
and repeated graph reads when exporting a complete point-in-time workspace graph.

This is a disposable SDK experiment, not a DLF workflow implementation. It uses Jazz,
Vitest, Playwright, Vite and Node utilities. It must not import DLF's admission or capture machinery. Use the
installed `jazz-tools@2.0.0-alpha.59`, an explicitly in-memory server on an automatically assigned
loopback port, and independent native client sessions. Never load Finance configuration or data.

Test choreography (ordinary test code; no application actor/workflow is being introduced):

1. Seed a workspace -> entry -> file -> byte-part graph in one native transaction.
2. Optionally warm the reader's local copy. Open a native transaction and read the workspace.
3. A separate native client atomically changes all revisions and the bytes; await Core acceptance.
4. Establish that the reader's ordinary remote queries see the newer state. Read the remaining
   graph and reread the root through the original transaction. Record whether they stay at the
   first read's version, mix versions, return missing rows, reject, or remain pending.
5. Release the read transaction by rollback. Separately probe read-only commit/wait behavior and
   verify that it does not alter application rows.

Also probe an initially cold replica, locally persisted offline writes (both subsequently accepted
and rejected), bounded byte ranges, and read permission changes. These distinguish a stable
transaction view from complete remote coverage, Core acceptance, and current authorization.

The Node test retains open transactions and rolls them back in cleanup; committed transactions
are observed through their native verdicts. Browser contexts are disposable and closed in cleanup.
Bounded observations record an expired deadline as pending, never as a native failure or proof
of cancellation. Sessions and test servers close after the matrix, including failing probes.
Observations contain only synthetic revisions/bytes and operation outcomes. Native
credentials are neither logged nor written to the observation artifact.

Run: `pnpm exec vitest run --config fixtures/native-capture/vitest.config.ts`

The runner needs local-listener access. It writes observations to
`/private/tmp/dlf-native-capture-observations.json`. No experiment changes are automatically added
to PR #28. Results and limits must be reviewed before changing the backup design.

## Result: use the native exclusive verdict

All **18 probes passed** on the pinned SDK, including persistent Chromium using Jazz's real
SharedWorker/IndexedDB driver. TypeScript and lint also passed. Final matrix runtime was about
four seconds; this is a tiny correctness experiment, not a Finance-size performance benchmark.

| Probe                                                                   | Observed result                                                                                          |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Ordinary separate queries                                               | Can mix an old root with newer child/file/byte data.                                                     |
| Warm mergeable/exclusive snapshot                                       | Retains the original graph and exact bytes across another client's commit.                               |
| Same-client writes, inserted/deleted children                           | Frozen reads remain at the original accepted version.                                                    |
| Byte ranges read before/after a replacement                             | Assemble the original bytes from the frozen view.                                                        |
| Cold replica, even using transaction `remote` reads                     | Can return empty results. Hydrating after opening does not repair that snapshot.                         |
| Exclusive read-only verdict for cold/incomplete results                 | Rejects; a newly hydrated capture succeeds.                                                              |
| Exclusive read-only verdict after conflicting changes/new matching rows | Rejects.                                                                                                 |
| Read permission changes                                                 | A frozen view can still expose cached rows; its exclusive verdict rejects the changed source.            |
| Pending optimistic write later rejected                                 | Can change an open snapshot's visible data; the exclusive verdict rejects the mixed capture.             |
| Capture overlapping a pending write later accepted                      | Also rejects. Hydrate again and open a fresh capture after settlement; that succeeds.                    |
| Read-only exclusive commit without conflict                             | Accepts while all application rows, original bytes and creation/update audit fields remain unchanged.    |
| Persistent Chromium                                                     | Confirms frozen bytes, conflicting/cold capture rejection and successful fresh captures after hydration. |

The initial cold-coverage hypothesis failed: a transaction snapshot alone does **not** prove the
complete server graph is present. Another initial hypothesis, that a pending source write could
be accepted along with the same already-open capture, also failed. These are SDK observations,
not reasons to add an application-wide writer registry. The successful native pattern is:

1. Authorize and hydrate the declared scope through ordinary remote queries.
2. Open one exclusive transaction and capture the scoped rows, relationships and bounded bytes
   through that transaction. Retain the captured plain data privately and validate its profile.
3. Commit with zero application mutations and await the native exclusive `wait()` verdict.
4. Produce the archive only after acceptance. Discard a rejected capture; any retry starts with
   fresh hydration and a new transaction. Offline acceptance remains pending.

For the tested cases, this replaces custom writer admission and repeated full graph comparison.
Keep domain coverage/validation, exact attachment handling, resource cleanup, protection and file
handoff. A read-only native commit is an engine transaction, not a mutation of application data.

This establishes a simpler architecture to qualify in Finance. It does not establish arbitrary
graph-size limits, memory use, throughput, every permission policy or behavior on other browser
engines. The experiment has not changed the implementation on PR #28; its admission design should
be reduced before merge rather than treated as required by Jazz.
