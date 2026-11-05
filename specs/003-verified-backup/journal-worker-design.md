# T004 — journal worker experiment (historical)

**2026-11-05. Disposition: worker implementation removed during the broader
[simplification review](restore-simplification-review.md).** The experiment passed functional
checks but supplied no convincing performance benefit. There is no current worker package export,
execution option or test app worker host. These notes preserve its design and measured outcome.

## Tested design

One persistent dedicated worker owned the existing journal statechart and native IndexedDB adapter.
The entire read/validate/CAS/write transaction stayed in one realm to avoid automatic commit while
waiting for another realm. Jazz, archive processing, planning, destination writes and page-side
request/reply validation stayed on the page. The installed Jazz account store uses localStorage;
moving Jazz itself would have required a separate storage change.

An optional journal execution capability flowed through shared restore/write factories and the
test app workflow. Each finite request used a MessagePort, random request ID and complete binding
including generation. Both realms admitted bounded detached metadata; replies were revalidated
after cloning. No archive bytes, password, account secret or admin credential crossed the channel.

XState owned page-host starting/ready/draining/closed/failed states, finite page request admission
and reply validation, server ready/busy/draining states, and each invoked journal job. A leaf owned
Worker construction/listeners/termination; fixed children owned requests and ports. Overlapping jobs
were rejected. Graceful shutdown drained the active journal child and outstanding replies before
closing the host; CLOSED alone could not prove receipt across separate task sources. Crashes left
unknown commits for fresh reconciliation. There was no retry, fallback success, transaction
keepalive, validation shortcut or larger bound. Cancellation could not preempt synchronous work.

The former implementation comprised worker protocol/channel/server modules, a worker package
entrypoint and test app host/bundler entry. These files and their dedicated tests are retired.
A local ignored source snapshot is retained at
`.svelte-kit/restore-review/retired-experiments-source.tar.gz`; it was taken during the subsequent
batching review and is not an exact source snapshot of the original benchmark revision.

## Historical qualification and result

Static typing, Svelte checks, package/public-package lint and worker bundling passed. The focused
unit run passed 184 cases, including 18 protocol/channel cases. Native Jazz/Chromium passed 68
distinct cases, including eight worker cases for complete restore/resume, cancellation, malformed
storage, CAS, startup failure, blocked shutdown, port release, abrupt stop and worker crash.
The full invocation passed 67 and encountered one missing compiled inspector-profile prerequisite;
compiling it and rerunning that case passed. This was not a single all-green full invocation.

Fresh-authority sequential main/worker measurements held the then-current reuse candidate constant:

| Metric                      | Main         | Worker       |
| --------------------------- | ------------ | ------------ |
| Restore through activation  | 323,959.3 ms | 395,630.8 ms |
| Largest restore timer delay | 212.1 ms     | 201.6 ms     |
| Restore delays >50 ms       | 5            | 21           |
| Restore delays >100 ms      | 4            | 4            |
| Sampled page heap peak      | 175.5 MiB    | 150.9 MiB    |
| Sampled renderer RSS peak   | 1218.2 MiB   | 1256.9 MiB   |

Both completed 633 records, 672,633 payload bytes, an 897,082-byte file, 635 writes and a
248,098-byte journal. Worker startup/shutdown took 28/30.5 ms; all 3,178 requests received replies.
Round trips totaled 135,070.5 ms (122.2 ms maximum), including execution, native storage, copying,
messaging and scheduling. They are not CPU time or attribution of the duration gap.

The worker was 22.1% slower in this pair with more medium delays and higher sampled renderer RSS.
Page heap excluded worker heap, so its decrease did not demonstrate a total-memory improvement.
A single pair did not establish a general regression, but did not justify retaining this added
complexity as a performance fix. No throttled/mobile, other-browser or new CPU-profile claim follows.
The [complete measurement report](record-performance.md#journal-worker-comparison) preserves raw
file locations, sampling limits and historical instrumentation. Current measurements use the
simpler main-thread path with bounded consumer transactions.
