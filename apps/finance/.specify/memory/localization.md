# Localization memory

These are user-approved conventions from the message consolidation review. Read this before adding
or changing messages, labels, noun forms, or their callers. Apply the patterns across the message
catalog; account and transaction are examples, not the limits of the convention.

## Explicit permission for Paraglide edits

Never edit Paraglide message catalogs, configuration or generated files without
specific user authorization. A general feature or UI request does not authorize
translation edits. Before proposing new strings, give the user a list containing
each exact string, its purpose and location in the code, and why an existing
string or generic action/label cannot serve that purpose. Wait for explicit
approval before adding them. Reuse existing strings whenever possible. Apply
this rule before any other instruction here to consolidate, rename or remove
messages. An explicit request to remove a particular message authorizes that
removal only. Do not regenerate Paraglide files without authorization to do so.

## Concise user-facing feedback

Treat a successful local save as saved. Say “Saved”, without “locally”, remote
acceptance caveats, replication explanations or notices about locally available
history. Users do not need those implementation details. A dedicated Jazz sync
status design is deferred until the user chooses to add it. Preserve technical
persistence/settlement distinctions internally for correctness without narrating
them in ordinary UI feedback. Keep UI copy and assistant communication concise;
do not add explanatory notices the user did not request.

## Consolidate reusable structures

Store regularly used entity nouns under `nouns`, with Paraglide plural variants selected by `count`.
Use the shared noun in standalone labels and as an interpolated argument. Do not keep separate
`labels.account` and `labels.accounts` copies alongside `nouns.account`.

Move reusable verbs into `actions` and reusable label structures into `labels`. Replace the old
entity-specific messages and migrate their callers. Adding more entity-specific strings does not
satisfy a request to consolidate strings.

Concrete examples:

| Before                                           | Shared message                                   | Caller input                                 |
| ------------------------------------------------ | ------------------------------------------------ | -------------------------------------------- |
| `accounts.filters.legend`: `Filter accounts`     | `actions.filter_subject`: `Filter {subject}`     | `subject: m['nouns.account']({ count: 2 })`  |
| `accounts.filters.all`: `All accounts`           | `labels.all_subjects`: `All {subjects}`          | `subjects: m['nouns.account']({ count: 2 })` |
| `accounts.manage`: `Manage accounts`             | `actions.manage_subject`: `Manage {subject}`     | plural account noun                          |
| `bank.discover`: `Discover accounts`             | `actions.discover_subject`: `Discover {subject}` | plural account noun                          |
| `labels.account_name`, `labels.workspace_name`   | `labels.subject_name`: `{subject} name`          | singular account or workspace noun           |
| `labels.account_type`, `labels.transaction_type` | `labels.subject_type`: `{subject} type`          | singular account or transaction noun         |

For a standalone collection heading, the count selects the plural noun without displaying a number.
For an actual quantity, pass the real count. Noun messages own grammatical number; do not append
English suffixes or branch on `count === 1` in components.

## Make inputs explicit in names

Message keys containing interpolated text identify their inputs. Use `subject` for an entity noun,
`subjects` for a plural noun, and `name` for an actual user/provider-assigned record name. Use the
same names in the key, message placeholders, and caller arguments.

- Replace `actions.add: Add {name}` with `actions.add_subject: Add {subject}`.
- Replace `actions.select: Select {name}` with `actions.select_subject: Select {subject}`.
- Use `labels.all_subjects: All {subjects}` for a plural noun.
- Use `status.saved_subject: {subject} saved.` for a generic save confirmation.
- Use `status.saved_subject_name: {subject} {name} saved.` when the record's actual name is included,
  for example `subject: m['nouns.account']({ count: 1 }), name: account.name`.
- Use `actions.move_up_name: Move {name} up` when moving a particular named record.
- Use `transactions.daily_total_amount: Daily total: {amount}` for an amount-bearing message.

Plural noun keys remain entity names such as `nouns.account`; their `count` input selects a grammatical
variant. Ordinary interpolated messages identify all displayed inputs in their keys.

## Keep wording and ownership consistent

Use `Select` for selecting existing items. Use `Add` consistently for ordinary finance record entry;
`Create` remains appropriate for creation-specific operations such as workspace and passkey creation.
Reuse the same template for the same structure rather than inventing a synonym for each entity.

Presentation translates and composes localized noun/action messages. Machines may carry message
keys/descriptors; keep their references aligned without changing workflow behavior for a wording
cleanup. Do not turn these straightforward message calls into controllers or workflow abstractions.

Keep context-specific validation, recovery, security explanations, and instructions intact when
abstracting them would lose meaning. A shared short phrase is a clear consolidation opportunity;
a longer sentence merely mentioning an account is not automatically the same reusable structure.
Do not replace proper names, actual record names, or persisted default category names with generic
entity nouns.

When reviewing a cleanup, inspect the whole catalog for remaining repeated structures and every
renamed key's callers, including contracts, metadata, and existing test fixtures. Remove obsolete
keys rather than leaving compatibility duplicates. Compile Paraglide, format touched files with the
repository configuration, and check types. Follow the repository's implementation-review gate before
adding or running tests; mechanical updates to existing key references do not add coverage.

## Reusable component catalogs

Keep strings rendered inside reusable photo components in their own component catalog (for example,
`messages/photo-cropper/{locale}.json` and `messages/image-editor/{locale}.json`). Keep Finance-owned
modal titles, attachment validation, persistence feedback, and other consumer labels in
`messages/{locale}.json` under `images`. Compose shared image format and size guidance from separate messages in each consumer. Component catalogs own their internal controls and accessible labels;
Finance consumers use Finance messages rather than reaching into a component catalog.
