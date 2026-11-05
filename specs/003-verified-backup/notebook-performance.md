# Notebook large-file measurements

Measured 2026-11-04 (America/New_York), macOS 26.6.2, Apple M4 Pro, 24 GiB RAM,
Node 25.2.1, pnpm 10.22.0, Chromium 148.0.7778.96, Jazz 2.0.0-alpha.59, XState 5.33.2.
Disposable local Jazz authority; password-protected archives use the existing 600,000-iteration
PBKDF2/AES-GCM format. Source: one notebook, three notes, one shared binary attachment.

| Attachment | Retained file | Export | Open   | Restore through activation | Largest timer delay | Sampled JS heap peak | Sampled renderer RSS peak |
| ---------- | ------------- | ------ | ------ | -------------------------- | ------------------- | -------------------- | ------------------------- |
| 1 MiB      | 1.78 MiB      | 171 ms | 105 ms | 1,366 ms                   | 100 ms              | 58.5 MiB             | 809.8 MiB                 |
| 4 MiB      | 7.11 MiB      | 473 ms | 341 ms | 2,360 ms                   | 345 ms              | 119.1 MiB            | 1,067.5 MiB               |
| 8 MiB      | 14.22 MiB     | 886 ms | 602 ms | 3,646 ms                   | 684 ms              | 248.6 MiB            | 1,333.3 MiB               |

All three runs returned `complete` after actual local persistence, remote acceptance, full graph
comparison and activation. The largest attachment equals the current per-attachment limit.
These are single-run observations, not latency budgets. No thresholds are added to CI.

## Method and reproduction

```sh
pnpm install --frozen-lockfile
pnpm package
pnpm check:backup-notebook
pnpm measure:backup
```

The optional cases in `restore-browser.test.ts` generate deterministic bytes in the browser,
export through the real capture/envelope actors to a retained byte copy, reopen that copy, and
restore against the actual Jazz server. Only metrics cross the browser test boundary. The source
fixture is prepared before timing; memory sampling starts before fixture construction, so the
reported memory includes its construction and the loaded application/SDK. Each case gets a fresh
browser context. The regular functional suite does not run these optional measurements.

CDP `Performance.getMetrics` samples used JavaScript heap approximately every 25 ms. OS `ps` samples
RSS every 100 ms for the two Chromium renderer processes reported by CDP for this harness. RSS is
summed across those renderers; shared resident pages may therefore be counted twice. It includes
renderer native/WASM allocations, but excludes the browser process, local Jazz server and Node test
runner. JS baseline was 11.5–12.2 MiB; summed renderer baseline was 357–361 MiB. Sampling may miss
short peaks; neither number is a claim about exact whole-system peak memory. Raw metrics are written
to ignored `.svelte-kit/notebook-performance-{1,4,8}.json` for repeat experiments.

A 16 ms browser timer records its largest scheduling delay from export through restore. This
captures blocking experienced by other work on the same event loop; timer scheduling and GC also
contribute. The SDK and codec still do synchronous work. The 8 MiB result has a substantial pause
and high memory use, so this does not establish responsive phone behavior or justify larger limits.

The first exploratory implementation re-encoded observed attachment bytes for canonical graph
comparison; the 8 MiB run sampled 870.7 MiB of JS heap and a 700 ms timer delay. Inspection also found
that the measurement fixture constructed per-byte string ropes. The final implementation compares
attachment bytes directly, and the measurement fixture uses bounded string chunks. The table uses
that final code; because both changed, this is not a controlled attribution of the improvement.

## Qualification boundary

T004 now has a reproducible bounded desktop baseline for realistic binary files through the
current maximum attachment size. It does not cover maximum aggregate archive size, 50,000 records,
slow networks, other browsers, mobile hardware, or deployed Finance data. T007 still owns the actual
consumer inventory and sizes. Keep that consumer/platform performance qualification open rather
than treating desktop functional success as a production memory/responsiveness guarantee.
