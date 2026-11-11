# Localization memory

Read before adding or changing messages, labels, accessible names, or message callers.
Adapted on 2026-10-31 from Finance's `.specify/memory/localization.md` at `8ff72f6`
and DUI's caller-owned label conventions at `9bc5405`.

## Reusable messages and explicit inputs

Use Paraglide. Consolidate regularly reused nouns under `nouns` with plural variants selected by
`count`. A standalone collection heading selects the plural without displaying an invented quantity;
a real quantity uses the actual count. Do not append English suffixes or branch on number in views.

Share reusable verbs under `actions` and label structures under `labels`. For example:

| Key                         | Message                   | Input                                 |
| --------------------------- | ------------------------- | ------------------------------------- |
| `actions.select_subject`    | `Select {subject}`        | localized workspace noun              |
| `labels.subject_name`       | `{subject} name`          | singular localized noun               |
| `labels.all_subjects`       | `All {subjects}`          | plural localized noun                 |
| `status.saved_subject_name` | `{subject} {name} saved.` | localized noun and actual record name |

Use `subject` for a noun, `subjects` for a plural noun, and `name` for a user-assigned name.
Variable-bearing keys identify displayed inputs consistently with placeholders and caller arguments.
Plural noun keys remain entity names such as `nouns.workspace`; `count` selects their variant.
Migrate callers and remove obsolete duplicate keys when consolidating a structure.

Keep wording consistent for the same action. Use Select for existing choices; Create is appropriate
for workspace creation. Do not import Finance-specific nouns or entry wording into this library.
Keep recovery/security instructions and context-specific validation intact when abstraction would
lose meaning. Whole sentences remain translatable; never assemble them with English concatenation.
Reusable short templates must still be reviewed for the grammar of supported locales.

## Catalog and presentation ownership

The library owns messages for the internal controls, instructions, errors, and accessible labels of
its identity/workspace compositions. Consumers own app navigation, domain text, and app-specific
operation explanations. DUI receives caller-localized strings/snippets and does not acquire a
foundation translation dependency or generic English fallback.

Keep reusable component catalogs separate from consumer catalogs. Consumers must not reach into
private component catalogs for their own labels; shared public labels require an explicit supported
contract. Do not import Finance's generated Paraglide module or catalogs into this library.

Presentation translates and formats; machines emit typed outcomes or message descriptors rather
than retaining translated strings. Changing locale must update visible and accessible text without
restarting operations. Do not build a controller merely to relocate ordinary message calls.

Before implementing catalogs, the technical plan must settle library message packaging, generation,
consumer overrides, locale propagation/SSR isolation, and supported locales. These conventions do not
select a process-global locale singleton or impose foundation routes/middleware on consumers.

Inspect all renamed callers, including contracts, metadata, and existing fixtures. Compile Paraglide,
check types, and format touched files with this repository's tooling once that integration exists.
Follow implementation review approval before adding or running tests. This documentation task adds
no catalog, generated output, dependency, or build integration.
