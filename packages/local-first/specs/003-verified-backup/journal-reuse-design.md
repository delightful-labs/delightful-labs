# T004 — immutable journal reuse experiment (historical)

**2026-11-05. Disposition: serialized caches retired during the broader
[simplification review](restore-simplification-review.md).** The measurements below describe the
earlier implementation, not the current code.

The approved experiment split the journal codec into a private module and retained normalized
records/intents plus exact serialized JSON in three weak maps. Only schema-produced detached,
deeply frozen values qualified. Foreign objects, frozen caller copies, proxies, fresh stored bytes
and new checkpoints retained full validation. Each encode returned independently owned bytes;
actual wire bounds, successor/CAS checks, exact intent matching and durability stayed enforced.
No workflow or native-operation ownership changed.

The focused qualification passed 166 journal/preparation unit cases and 15 Chromium journal cases,
including mutation/proxy/frozen-input admission, independent output ownership, IndexedDB reload,
CAS, interruptions, rejected attempts and initialization. These totals describe that revision.

One fresh-authority 633-record restore completed exact comparison and activation:

| Metric                    | Before       | Reuse experiment |
| ------------------------- | ------------ | ---------------- |
| Restore                   | 322,939.0 ms | 313,935.6 ms     |
| Largest timer delay       | 197.4 ms     | 198.2 ms         |
| Sampled page heap peak    | 139.6 MiB    | 161.5 MiB        |
| Sampled renderer RSS peak | 1184.6 MiB   | 1334.4 MiB       |

Both used 672,633 payload JSON bytes, an 897,082-byte file, 635 issued writes and a 248,098-byte
final journal. A single 2.8% duration reduction with higher sampled memory did not establish a
net performance benefit. [Full method and raw artifact locations](record-performance.md#immutable-reuse-comparison)
remain preserved. No throttled/mobile or whole-suite qualification was claimed at that point.

The later broad review removed retained JSON/comparison caches and the extra codec module.
The current [public codec](../../src/lib/backup/restore-journal.ts) uses two private weak sets solely
to recognize its own deeply frozen record/intent outputs. It retains no serialized representation;
comparisons use complete exact JSON and encodes always create fresh bounded bytes. Full foreign
admission, detached-output budget checks and actual wire-size checks remain. The
[reuse-boundary tests](../../src/lib/backup/restore-journal-reuse.test.ts) continue to cover these
trust and ownership boundaries. Object identity is neither authority nor settlement evidence.

The current performance change instead removes byte-count allocations and bounds consumer
transaction groups; see the simplification review. T004 still requires actual Finance/platform
qualification after T008/T009.
