# Independent retained-file inspector design

T005 follows merged PR #17. This is a headless tool and reusable workflow, not Finance capture,
a restore importer or a new product route. The user authorized proceeding with implementation review/tests on 2026-11-03.

## Protocol and statechart

```text
claim request -> read bounded source -> inspect strict envelope header
  encrypted without password source -> passwordRequired -> cleanup
  encrypted with password source -> read password -> prepare opaque request -> open envelope child
  plaintext -> prepare opaque request -> open envelope child
open child -> integrity failed / interrupted -> cleanup
open child -> integrity checked -> match registered profile
  no exact profile ID/version -> integrityValidProfileUnsupported -> report -> cleanup
  exact profile -> pure domain validation -> profileValid / profileInvalid -> report -> cleanup
cleanup -> transfer report -> complete
```

File and password sources are bounded leaf capabilities observing AbortSignal, not hidden workflows.
The machine owns I/O and resource stage transitions; the existing envelope machine remains a real
invoked child. Exact profile lookup, synchronous validation and metadata report construction are one
pure inspection leaf, without separate promise actors or stored intermediate validation state.
CANCEL/SHUTDOWN abort pending reads, forward interruption to an active envelope child, wait for its
native work to settle, and release all owned handles. Request.release() is abrupt-stop cleanup:
abort reads, release any envelope request and checked/report resources, and discard/clear late bytes.
A narrow internal checked-output retention hook pins the child’s acquired result in its parent owner before the done event, so abrupt teardown cannot miss the handoff window. It carries no workflow decisions or raw snapshot fields. Stopping the actor alone is not cleanup. Failed claims must not release another actor’s resources.

The source transfers ownership of its returned byte array. The inspector checks it is bounded,
validates its header, creates the envelope request and clears its intermediate copy. Password input
stays private and is passed to the envelope request only; raw strings/bytes, file paths, validators
and decrypted payloads do not enter actor context or serialized snapshots. Read/profile failures
expose only safe codes. No callback or module is loaded from archive data.

Profile validators are explicitly injected trusted code, matched by exact ID and version. They are
pure synchronous boolean checks of the frozen payload. They may use consumer Zod schemas but do
not perform I/O, grant permissions or write data. No Finance schema or default Finance support is
invented here. A thrown validator error differs from an invalid profile. Neither profileValid nor
integrity success establishes source completeness, ownership, file retention on another device,
publisher authenticity or a successful destination restore.

The completed report is an opaque releasable handle. readSummary() deliberately exposes declared
archive/profile/source IDs, record/reference/attachment counts, byte totals, digest and protection;
it never includes record values or file names. Metadata is still private archive content, so the
handle serializes only a safe descriptor. The CLI explicitly prints the summary to its user, not to
telemetry. Decrypted records and envelope resources are released before completion; caller owns only
the summary handle. Cancellation during report handoff releases an undelivered report.

## Independent Node tool

`fixtures/backup-reader/inspect.mjs` imports only public inspection/workflow exports and XState.
Build/install once, then `pnpm backup:inspect <file> [--password-stdin]` works without network, Jazz,
a browser profile, provider login or original application service. There is no automatic build or
package install in the inspection command. Password bytes come only from optional bounded stdin,
not arguments/environment; UTF-8 is fatal and no trimming/newline removal occurs. No interactive
password prompt or browser UI is claimed in this slice. Default profile registry is empty, so the
tool reports integrityValidProfileUnsupported rather than pretending to validate Finance.

Node’s [createReadStream API](https://nodejs.org/docs/latest-v22.x/api/fs.html#fscreatereadstreampath-options)
supports an inclusive end offset and AbortSignal. The file adapter reads at most the 64 MiB limit
plus one detection byte; it does not stat and then perform an unbounded readFile that can race file
growth. Chunk totals are checked before a final bounded allocation. File descriptors close before
success/failure is returned. Stdin is limited to 1,024 bytes, and all owned chunks are cleared.
These are bounded native read adapters, not separate read/check/write workflows.

JSON output has explicit outcomes and safe error codes. Exit 0 means inspection completed (which
can still mean unsupported profile), 2 means password is required, and 1 covers failed/invalid or
interrupted inspection. SIGINT/SIGTERM drain the root operation. The tool never rewrites the archive,
opens domain storage, prints passwords/records or activates prior access grants.

## Implementation review and verification status

Implemented on `feat/backup-inspector`, based on PR #17 merge `1c5f376`. Public subpaths are
`backup/inspection` (preparation, profiles, report/result protocols) and `backup/inspection/workflow`
(the factory). The separate Node adapter imports those built public exports. It has its own static
check after package build; root checks do not depend on a previously generated dist directory.

No UI, Svelte route, message catalog or new dependency is added. JSON outcome/code fields are a
technical tool protocol; consumer-facing labels remain a later localized presentation concern.

The user authorized proceeding with review and tests on 2026-11-03. Review found that synchronous
source/password exceptions bypassed the intended error classification; both throws and rejected
promises now produce the appropriate safe read-failure code. Regression tests cover each. Review also reproduced Node Buffer aliasing: `Buffer.slice()`
shared the caller’s storage, so cleanup could erase the envelope input. Opening now copies into
an ordinary `Uint8Array`; regressions verify transferred inspector buffers and retained caller
buffers have the intended ownership.

Simplification review requested on 2026-11-03 removed two artificial asynchronous boundaries,
the cached profile match and validation context, duplicate retention of the same child result,
and envelope-request memoization for a single-use stage. Profile registration now reuses the
payload's Zod profile schema, including UTF-8 byte bounds and reduced limits. The Node adapter
uses one abort handler rather than both native and manual destruction, and trusts byte chunks
from its own unencoded streams. No generic actor framework or additional fallback was introduced.
Cancellation/drain, source byte bounds and the pre-handoff ownership hook remain because their
existing tests reproduce those cases. A released envelope cannot call the synchronous checked
output hook, so that hook no longer tests the parent release flag a second time.

Local verification:

- 30 inspector cases pass; all 639 repository unit tests pass across 27 files. Coverage includes
  unknown/exact profile versions, valid/invalid profiles, duplicate registration, frozen input,
  validator exceptions, passwords, reduced limits, opaque snapshots and report ownership. Every
  main actor stage is interrupted; late readers are drained/cleared; concurrent/reused requests
  cannot steal ownership. Abrupt stops at child result construction and handoff release retained
  decrypted resources through the new internal ownership hook.
- 11 separate-process/reader cases pass after packaging. They open actual retained plaintext and
  encrypted files, preserve original contents, reject newline/UTF-8/oversized passwords and
  corrupt/oversized files, bound concurrent file growth, sanitize paths/arguments and handle
  SIGINT/SIGTERM while password stdin is actually waiting. Children receive only PATH, and a
  preloader makes HTTP, TCP and fetch APIs throw. This is evidence for this tool’s independence,
  not a general network sandbox claim.
- Public declaration/consumer checks, reader type checks, formatting, Oxlint, full Svelte/TypeScript,
  package build/strict Publint and whitespace checks pass. Reader tests are integrated into
  check:consumer after packaging, preserving clean-build ordering.

The CLI has no Finance validator or application session, and no archive can load code. A zero exit
for an unknown profile means integrity inspection completed, not that content is domain-valid or
restorable. No user data, application storage or remote services were accessed. Final-commit GitHub
CI is checked separately before reporting completion; merge remains the user’s decision.

## Machine-first ownership correction — design before implementation

The user continued after envelope qualification. This slice corrects only inspection ownership;
export/capture, notebook lease ownership and the older workspace journal remain separate slices.
The earlier class-backed inspector test totals do not qualify this correction.

```text
claim input -> working (invoke source/password native adapter)
  reading -> checkingSource (bounds + strict header, pure)
    plain -> preparingEnvelope
    password + provider -> readingPassword -> preparingEnvelope
    password without provider -> passwordRequired -> cleanup
  preparingEnvelope -> opening (invoke envelope owner)
    failure/interruption -> cleanup
    integrity checked -> matchingProfile
      no exact match -> unsupported -> buildingReport
      exact match -> inspectingProfile (one synchronous validator call)
        true/false -> profileValid/profileInvalid -> buildingReport
        throw/nonboolean -> failure -> cleanup
  buildingReport -> transferringReport -> cleanup -> final
```

Context holds only opaque request/child handles, protection/password-source availability, matched
profile index, validation result and interruption/result facts. Source bytes, password strings,
validators, decrypted payloads and report summaries remain private payload data. Single-use claim
consumes an input capability; there is no class-owned claimed/released/pending lifecycle.

The native callback adapter performs one source or password read per machine command and translates
settlement. It owns the AbortController and late-result disposal, not header/password/profile
routing. The chart aborts reads on interruption, waits for an issued read to settle, and forwards
interruption to the invoked envelope owner. Releasing the request revokes the existing input
reference once and reports to its owner. Abrupt callback teardown aborts the read, clears private
resources and detaches reports; a late transferred byte array is cleared rather than published.
An ignored AbortSignal still requires provider settlement for graceful drain; no new timeout/retry
or claimed cancellation guarantee is added. Abandoning an unattached prepared request still requires
explicit release. No actor is manually started beneath this owner.

Pure helpers construct the envelope request, register the checked-output retention hook, find an
exact profile, call its synchronous validator, and construct a report. They do not coordinate async
stages. The chart chooses unsupported/valid/invalid results and explicitly transfers the report
before its working scope disposes other resources. Late cancellation during final handoff releases
an undelivered report. Failed claims cannot dispose a different owner's resources.

Replace Inspection and Report classes with private data and inert resource functions. Replace the
error subclass with createArchiveInspectionError/isArchiveInspectionError and mechanically migrate
the independent reader adapter. This changes error construction/type checking only; no CLI outcome,
exit status, translated copy, archive format or validation guarantee changes. Present implementation
for review before adding/running tests for this correction; static checks are not race qualification.

### Ownership correction qualification after implementation review

The user authorized continuation from the inspection implementation review. The original 134 focused
envelope/inspection/export cases passed without production fixes. Added six bounded cases: cancel
at checkingSource, matchingProfile and buildingReport; repeat release during an active source read
with one revocation report and drain/byte clearing; release during an issued envelope digest and
wait for native settlement; and clear late bytes after actor stop without explicit request release
once the native read owner is attached. Existing source/password cancellation, safe failures,
concurrent claims, profile outcomes, snapshot secrecy and child output retention cases still pass.
All 140 focused unit cases pass. No production implementation changes were needed in qualification.

After rebuilding the package, all 11 independent reader cases and 13 notebook/public-package
integration cases pass. These include real retained plaintext/encrypted files, exact stdin password
bytes, invalid/bounded inputs, sanitized errors, SIGINT/SIGTERM during pending password input and
independent retained notebook content inspection. Fresh public-export browser bundles pass all four
focused Chromium cases: standalone envelope crypto/integrity, plain/password notebook downloads and
inspection, and invalidation/drain/stale binding handling. Playwright owned a temporary preview on
localhost port 6014 and stopped it after the run.

Svelte/TypeScript, package/strict Publint, reader/public-consumer declarations, lint, formatting and
whitespace checks pass. These focused checks qualify this inspection correction with the existing
export/notebook owners; they do not qualify the pending export/notebook rewrites or journal
correction. No full repository unit/browser suite was run. Graceful drain still depends on a
provider eventually settling when it ignores AbortSignal; password string zeroization, large-file
memory/latency and additional browsers remain unqualified. No commit, publication or merge.
