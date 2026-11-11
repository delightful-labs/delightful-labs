# Transaction sync status

## Requirement

Show one status icon on every transaction list item. Hover text and accessible
text must use the same localized label: Waiting, Synced, or Error. Use existing
TDesign icons and AppIcon without adding status colors or animation.

Waiting includes queued writes and writes awaiting Core confirmation. Synced
requires Core confirmation, not local persistence or browser connectivity. Error
means a tracked write failed or was rejected. Do not label unobserved rows Synced
by default.

## State model and ownership

A session-owned supervisor under src/lib/machines/ owns transaction write actors.
Each write actor starts in waiting, invokes a global confirmation wait, and enters
synced on confirmation or error on failure. Replacement session/shutdown cancels
observation, not the underlying Jazz write. Old-session completions cannot update
the replacement session. The form continues to finish after local persistence;
remote confirmation must not block offline entry or provider imports.

The supervisor owns transaction-ID-to-write associations across route navigation.
The integration binds Jazz and storage dependencies and passes projected statuses
to the pure TransactionList and TransactionListItem components. Both manual entry
and bank imports register their writes. A new write makes that item Waiting again;
older write completion cannot overwrite a newer write's outcome.

Reload recovery is part of correctness. Persist device-local write associations
scoped to Jazz storage namespace and identity, without adding replicated sync
fields to finance schemas. Before implementing recovery, establish a supported
SDK mechanism for reopening confirmation of persisted transaction IDs. The
installed public Db API returns waitable mutation handles but does not expose a
public method to reopen those handles. JazzClient.waitForTransaction exists below
Db; do not silently depend on protected/internal accessors.

Previously existing rows also need evidence of remote acceptance. Audit supported
remote reads as a source of initial confirmation, preserving offline cached
confirmation. A missing remote result alone proves neither failure nor rejection.
Do not conflate query/network failures with rejected writes. If the SDK cannot
provide the required evidence, report that limitation before implementing a
misleading default or silently dropping reload recovery.

## Presentation

Use a clock for Waiting, a check mark for Synced, and an error icon for Error.
Render a wrapper with role="img", aria-label and title both derived from one
localized label; AppIcon keeps the SVG hidden from assistive technology. Pass the
status through props. Place it beside the transaction amount using existing
spacing tokens. No interactive control or retry behavior is requested.

## Proposed implementation scope

This requires more than the normal 4–6 implementation-file batch: a status
machine/contract, a session integration owner, persistence adapter, the manual
write adapter, bank import adapter, three transaction list components, and English
messages. Final paths depend on the supported SDK recovery mechanism. No schema
change or SDK-internal dependency is authorized by this proposal.

## Review and verification checklist

- [x] Record requested labels, accessible presentation and state ownership.
- [x] Identify SDK recovery limitation and both existing transaction write paths.
- [ ] Review the broader implementation scope before editing application files.
- [ ] Resolve supported recovery/initial confirmation API and finalize the model.
- [ ] Implement the approved model, format affected files and run static checks.
- [ ] Present implementation for review before adding or running tests.
- [ ] After approval, cover offline Waiting, reconnect confirmation, rejection,
      reload/navigation, stale completions, session isolation, imports and matching
      tooltip/accessibility labels with focused unit and browser tests.

No application files or tests changed in this model review cycle.
