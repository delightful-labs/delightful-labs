# Internal archive compatibility findings

Evidence: [archive-comparison.json](archive-comparison.json), generated against the
exact committed candidate sources in [source-inventory.json](source-inventory.json).
Only archives actually referenced by dependency/devDependency/optionalDependency
entries are compared. Unreferenced historical archives remain in the source
inventory and are not candidates for workspace resolution.

Reproduce from the destination checkout with Python 3.9 or newer:

```sh
python3 scripts/monorepo/compare-archives.py /path/to/source-parent > specs/002-monorepo-agent-guidance/archive-comparison.json
```

The tool reads archives directly from Git objects, hashes their bytes, compares
package contracts and archive file contents, and compares unchanged-extension
assets against selected source files. It does not extract archives onto disk,
execute package scripts, install dependencies, or mutate any source repository.
Comparison indexes refer to entries in the report's `archives` array.

## Decisions supported by the evidence

| Consumer | Finding | Migration treatment |
| --- | --- | --- |
| Finance and Clipper UI | All 122 packaged files are byte-identical between their UI archives. All 59 directly comparable source assets match selected UI `7a7f61b`; exports and runtime dependency contracts match too. | One candidate UI baseline can serve both; generated JS/declarations and consumer behavior still need qualification. |
| Website UI | Compared with the Finance UI archive, 21 common files differ and 8 files are added. Seventeen directly comparable assets differ from selected UI source. | Keep the current website archive during the website move. Replacing it is a separate library compatibility slice. |
| Local First's development UI | Compared with Finance UI, 35 common files differ and Finance UI contains 40 additional files. Twenty-eight directly comparable assets differ from selected UI source. | Preserve this development dependency until package and component checks qualify its replacement. Do not overlook library dev dependencies in workspace linking. |
| Finance Local First | Compared with Clipper Local First, 6 common files differ and Clipper has 24 additional files. | Retain Finance's archive until source packaging and consumer verification cover these changes. |
| Clipper Local First | Public export map matches selected Local First source, but peer constraints differ. | Matching exports alone does not establish compatibility. Retain the archive until the Jazz version difference and emitted implementation are qualified. |

Both active Local First archives declare `jazz-tools: 2.0.0-alpha.60`; selected
Local First `9d6dd84` declares alpha.59. Both use XState `6.0.0-beta.1`.
The selected source adds 12 public export entries relative to Finance's package;
Clipper's archive already exposes them. Its 24 additional emitted files cover
owned operations, worker channels/requests/effect draining, domain transactions
and ordered sign-out. The changed shared implementation includes Jazz startup
and identity session acquisition. These are compatibility obligations, not
permission to upgrade consumers as part of moving files.

## Limits and next acceptance evidence

Packaged JavaScript and declarations are compiled artifacts. Comparing TypeScript
source text directly with emitted JavaScript would produce misleading results.
The report explicitly classifies these as generated or unmapped, not as equal or
as consumer-only changes. A source file differing from a snapshot also does not
prove an unpublished consumer modification; it may reflect normal library history.

Before accepting a workspace replacement:

1. Build each selected library revision in an isolated directory with its recorded
   toolchain, generated localization and package configuration.
2. Compare emitted package files against the active archives. Trace remaining
   differences through history, retaining consumer-only changes or recording an
   explicit compatibility resolution.
3. Qualify packed exports and affected consumer workflows under existing review
   and testing gates. For Local First, resolve alpha.59 versus alpha.60 against
   the actual Jazz APIs and patches rather than changing a version string.

The shell currently resolves Node `v25.2.1` and pnpm `10.28.0`. Node 25 falls
outside Clipper's recorded `<25` requirement. Therefore this audit establishes no
common install/build baseline. A compatible Node 24 runtime and pnpm qualification
are still required before claiming that all projects build together.

Validation: the audit completed against six active archives across four consumers;
its byte-level comparison identified the identical Finance/Clipper UI payloads.
A repeated generation produced identical JSON. No application tests or package
builds were run, and this audit changes no effective source or dependency policy.
