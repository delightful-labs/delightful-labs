# Attachment read inheritance

This standalone diagnostic reproduces permission publication behavior in the installed
`jazz-tools@2.0.0-alpha.59`. It starts disposable in-memory servers and stops each server after
publication succeeds or fails. It does not connect to the application's Jazz server or load user data.

Run from a checkout with dependencies installed (verified with Node 25.2.0):

```sh
node --experimental-strip-types specs/013-local-first-startup/reproductions/attachment-read-inheritance.repro.ts
```

Exit zero means the expected SDK failure was reproduced; it does **not** mean attachment authorization
is fixed. The recorded output is in `attachment-read-inheritance.results.json`.

The schema is identical across three scenarios. Transaction read access checks grants against the
current user and correlated transaction fields. Links point to transactions, and files inherit read
access through referencing links.

| Scenario                  | Transaction predicate                     | Link predicate  | Publication |
| ------------------------- | ----------------------------------------- | --------------- | ----------- |
| existence                 | organizationId + accountId + current user | parent exists   | succeeds    |
| single-column-inheritance | accountId + current user                  | parent readable | succeeds    |
| two-column-inheritance    | organizationId + accountId + current user | parent readable | fails       |

The failing expression reports an invalid converted files read policy: `UnknownColumn` on `links`,
for `organizationId` or `accountId`. Both columns belong to the parent transaction. This isolates
the failure to this composition, rather than proving all read inheritance is unsupported.

This diagnostic checks publication only. The existing browser investigation separately demonstrated
that checking parent existence exposes links, metadata and explicitly requested synthetic file parts
for an unreadable transaction. Publication success is not evidence of authorization correctness.

An exploratory account-only explicit join published and filtered the reduced selected-grant fixture.
It has not preserved the complete organization and role semantics and is not a production fix.
Do not remove the organization correlation to bypass the compiler failure. The implemented alternative avoids reverse read inheritance: links inherit transaction reads, while
files inherit reads directly from their existing transaction relation and require a link matching
both file ID and transaction ID. Parts continue inheriting file reads. The full-app permission suite
passes positive and negative reads with this expression on alpha.59. This does not establish cold
query completeness or enable broad background preparation. The historical reproduction remains
useful for explaining why the reverse-inheritance expression was rejected.
