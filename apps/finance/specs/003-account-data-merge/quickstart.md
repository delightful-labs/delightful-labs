# Validation guide (after implementation approval)

Planning adds no tests and starts no server. Before each validation cycle, obtain review of the exact implementation under the repository agreement.

## Preparation

Use two browser profiles/devices with distinct recovery identities. Retain both phrases securely outside logs/fixtures. Populate both personal workspaces with manual finance data, similar-looking transactions, categories/tags, checks and archived history. Include provider-backed transactions where available; never put live bank credentials into test fixtures.

When starting the development server, announce its URL to the user. Use the repository's documented local configuration and `pnpm dev`; use the actual reported URL, not an assumed port.

## Scenarios

1. Merge: source summary → switch → target preview → confirm → both sets visible in destination. Verify reference and money/date integrity, unchanged existing rows and intact source data by explicitly returning to the source.
2. Remote only and Cancel: no import; explain session identity after each cancellation boundary. Same identity creates no copies.
3. Interruption: reload/close during snapshot, switch and partially committed import; resume without duplicates, overwrites or credential exposure. Repeating a completed merge also creates no duplicates.
4. Conflicts: same-looking manual transactions stay separate; canonical bank collisions are existing/conflict. Later target edits survive retries. Source graphs with unsupported attachments stop before writes.
5. Archives/checks/tags/batches: preserve values and links, archive only after dependent history is valid. Confirm permissions remain enforced for unrelated users/workspaces.
6. Network and lifecycle: offline switch/hydration failure is recoverable; no false complete-on-empty. Test another tab, identity replacement, route exit, permission loss, cancellation during restore, late effects and shutdown cleanup.
7. Banking: transactions retain provenance; credentials are excluded, reconnect notice appears, and merging causes zero provider discovery/sync requests.
8. Local completion versus sync: verify distinct feedback and eventual visibility on the destination's other device after supported synchronization confirmation.

## Checks

During implementation, use focused repository Prettier and type checks. After approval, add/run only relevant Vitest machine/mapping/journal/permission coverage and Playwright authentication/merge flows. Select exact test paths when they exist; do not invoke a speculative full suite. Physical cross-device validation remains necessary before declaring cross-device merge support.
