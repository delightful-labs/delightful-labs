# Companion Lexicon review artifacts

These concrete JSON drafts carry the previously approved companion fields,
including the Highlight's optional source position anchor. Their proposed names
are `com.delightfullabs.clipper.highlight` and `com.delightfullabs.clipper.note`.
The namespace and a direct `@atcute/lexicons@2.1.1` dependency have been presented
for approval. These files are review artifacts, not installed or published schemas.
No application import, package manifest, lockfile, DNS or public repository record
has changed for this step.

The drafts retain `key: "tid"` from the earlier illustrative proposal. That key
restriction is still a proposal. Key generation, whether a companion reuses its
Margin record's key, and discovery must be reviewed before these become active
Lexicons. This draft allocates no public identity.

Runtime checks must supplement Lexicon validation: references must identify full
records in the expected collections under the publishing DID; common and
companion article/subject values must agree; attached links must be reciprocal.
HTTP(S) source restrictions, lowercase SHA-256, nonblank normalization version,
position ordering/bounds and agreement with verified source evidence remain
application checks. No Jazz IDs, quotation, commentary, private organization or
additional timestamps are added to these records.

The proposed runtime dependency is already installed transitively through the
existing OAuth integration. Its supported syntax exports include canonical
record-URI and DID parsing plus CID validation. The installed CID validator
accepts the protocol's supported CID subset; it does not calculate a record CID
or prove that a remote record exists. Canonical DAG-CBOR CID calculation and
conditional PDS writes remain separate work.

Primary references: [Lexicon](https://atproto.com/specs/lexicon),
[record keys](https://atproto.com/specs/record-key),
[AT URIs](https://atproto.com/specs/at-uri-scheme),
[strong reference](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/strongRef.json).
