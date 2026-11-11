# Localization and copy

The stricter copy/catalog approval rule applies to every project. Before adding
or changing product strings, accessible labels, plurals, keys, catalogs,
localization configuration or generated localization output, obtain explicit
user authorization. A feature request, missing translation or silence does not
supply it. Do not bypass approval with hardcoded English, inline fallbacks,
secondary catalogs or speculative variants.

First search existing messages, action templates, nouns and usage sites. Propose
exact keys, wording, interpolation inputs and plural/context forms; explain the
usage location and why existing approved messages cannot serve it. Record the
approval and keep it scoped. Permission to remove one message covers only that
removal. Authorization for existing build/test generation does not authorize
new catalog entries or wording.

Keep reusable verbs, nouns and labels consistently named with explicit displayed
inputs (`subject`, `subjects`, `name`). Use actual counts for quantities and the
localization framework for grammatical number. Do not append English suffixes or
concatenate sentence fragments. Preserve complete, translatable status/security
instructions when a generic template would lose meaning. Reuse must not mislead.

## Ownership and retained translation boundaries

UI receives caller-localized labels/snippets. Local First owns composition copy;
applications own domain text, navigation and app-specific explanations. Consumers
must not reach into private component catalogs or import generated modules from
another app. No shared framework, process-global locale singleton or new strings
are introduced by this guidance.

Finance and Local First use Paraglide and machine-selected typed message
keys/descriptors; presentation translates/formats reactively. Clipper uses i18next
and its existing worker/machine-owned ready-to-render feedback. These are
incompatible placement conventions, not a strictness ordering. Keep message
selection in its workflow owner and preserve the existing explicit boundary;
changing it requires a separate reviewed contract. Never persist translated
strings. Do not invent an app exception to the shared approval rule.

Finance's detailed naming/catalog ownership remains in its local memory.
Clipper's catalog/action/noun layout remains in its local memory. Website content
and typography are owner-controlled, with the exact existing homepage/embed/
portrait authorizations in its entry file. Catalog strings must not be used to
smuggle unapproved editorial content or a visual direction.

Keep ordinary feedback concise. A successful local save is saved; retain
local/remote/unknown settlement internally without unsolicited replication notices.
An explicit separately approved sync-status design remains its own scope.
