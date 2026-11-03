# Archive payload codec — first implementation review

Branch: `feat/backup-archive`, based on merged PR #15 (`b6c08df`).

## Scope and ownership

This slice implements only the synchronous payload layer of the archive core. Public functions:
`encodeArchivePayload(input, limits?)` and `parseArchivePayload(bytes, limits?)` under
`delightful-local-first/backup/archive`. They have no Jazz, Svelte, XState, browser session, domain,
file-system or network dependency. Zod 4.1.11 is an internal runtime dependency, pinned to the version already used by Finance. Standard UTF-8 facilities are the only platform dependency.

The encoder accepts untrusted-shaped application data, validates it, and emits deterministically
ordered UTF-8 JSON. The parser bounds input bytes before fatal UTF-8 decoding, rejects BOM and
duplicate JSON keys (including escaped aliases), validates exact structure, and returns detached,
deeply frozen payload data. Generic record references resolve against the union of domain and inert
reference records; the profile will decide whether any particular relationship is domain-valid.
Inert provenance uses the same `{ type, id, fields }` shape and a disjoint `(type,id)` identity.

No asynchronous effects or resources are acquired: the operations are synchronous transformations,
so this slice needs no stateful actor. Crypto/resource acquisition and lifecycle ownership require
separate design review before their async implementation. Callers own input/output buffers and
payloads; this raw structural data must not enter diagnostics or persisted actor snapshots.

## Schema validation

At the user’s request, Zod replaces the handwritten object, array, primitive, date and timestamp
validators. Strict objects and a discriminated union define the payload; public value/record/file/
payload types are inferred from those schemas rather than duplicated interfaces. No coercion,
trimming or normalization is used. Nested readonly schemas and explicit final array freezing retain
immutable detached output. Public failures discard Zod issues and expose only safe archive codes.
Consumers do not supply Zod schemas or integrate with its parsing API to use the archive functions.

The installed Zod source was inspected, not just the latest online documentation: `src/v4/core/regexes.ts`
defines calendar-aware date expressions and millisecond timestamp precision; `src/v4/core/schemas.ts`
shows that this version’s `z.record` skips `__proto__`. The field dictionary therefore validates
through `z.map` and reconstructs own data properties using `Object.fromEntries`, preserving that field
name instead of silently dropping it. Map conversion is internal; the wire format stays an object.

Archive-specific code remains for UTF-8/Unicode fidelity, canonical exact integers, bounded duplicate-
rejecting JSON parsing, canonical base64/byte counts, graph integrity and ordering. A generic resource
preflight bounds caller-supplied data before schema cloning and issue collection and rejects accessors,
sparse arrays and unsupported object prototypes without executing `toJSON`. This is not a second
shape validator. These cases still require post-review runtime tests.

## Limits and ordering decisions

The v1 limits are enforced for payload bytes, attachments, combined record counts, depth, text,
names and IDs. Consumers may lower, never raise, them. To bound object overhead as well as byte size,
this implementation adds 256 fields per record and 500,000 JSON values per payload. These limits
also apply to encoding; they are resource ceilings, not target support guarantees for real data.

Record types include types used by both live records and inert reference records. Identity is a
pair of strings, indexed without delimiter concatenation. Source strings are not normalized.
Ordering compares exact JavaScript UTF-16 string sequences, without locale or case folding. Object
keys are serialized explicitly in lexical order, including integer-like field names; ordinary
`JSON.stringify` alone would reorder such keys. Encoded output is bounded incrementally before
allocating its final UTF-8 buffer. Empty text/file contents are allowed; identifiers and names
are nonempty. All input is current-data only; archived status stays consumer-owned data.

## Deliberate remaining work

An attachment SHA-256 string is checked for format only; attachment content has not been hashed.
Canonical base64 and the declared decoded length are checked without allocating decoded attachment
buffers. There is no encryption envelope, password handling, crypto, file inspector, opaque verified
resource, consumer profile validation or restore capability yet. The parsed type is `ArchivePayload`,
not a validated/restorable backup. Source coverage labels are claims to be established by consumer
capture, not evidence produced by this codec.

## Review and verification

The user authorized proceeding with implementation review and tests on 2026-11-03. Review checked
schema strictness and inferred types, duplicate-key handling, prototype-named fields, detachment,
limits before schema processing, exact values, graph identity and public package boundaries.

One correctness finding was fixed: converting an arbitrary numeric JSON token to JavaScript Number
could round a long fractional version into an accepted integer. The parser now requires canonical
safe-integer metadata tokens before conversion; fractional/exponent forms, negative zero and unsafe
integers fail explicitly. Five regression cases cover this behavior.

Verification completed locally:

- 82 archive cases pass: independent literal wire data, all value variants, malformed/trailing JSON,
  escaped duplicate keys, prototype-named fields, invalid UTF-8, exact integer/date/timestamp rules,
  Unicode byte budgets, graph closure/identity collisions, canonical base64 and lengths, resource
  limits, immutability, cyclic/sparse input, getters/toJSON rejection and safe errors.
- All 556 repository unit tests pass across 25 files. The initial sandboxed full run could not bind
  disposable Jazz test listeners; the permitted rerun passed without changing those tests.
- Repository Oxlint, full Svelte/TypeScript checks, Oxfmt and Git whitespace checks pass.
- Package build/strict Publint, declarations through public exports, standalone Node ESM codec use
  and the browser consumer build pass. The consumer provides no Zod schema, Jazz or app session.
- Archive tests are included in the normal Vitest/CI configuration. No live data, storage or schema
  was accessed or changed. No encryption/digest/recovery readiness is implied.

PR #16 receives these verification changes; its final-commit CI status is checked separately before
reporting completion. Merge remains subject to the user’s explicit authorization.

These checks do not establish universal parser security, browser peak-memory limits or end-to-end backup safety. Cryptography and actual source capture/restore remain subsequent slices.
