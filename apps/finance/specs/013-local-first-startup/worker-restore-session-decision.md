# U2b: Finance workspace restore and the native Jazz session

Status: caller review identified an ownership decision; implementation pending. No application source,
SDK pin, account store or deployment destination changes are made by this record.

## What the code actually does

Finance's [workspace restore](../../src/lib/machines/workspaces/workspace-restore.ts)
is another consumer of the SDK account handle, beyond the recovery adapter ported
in U2a:

- `RestoreScope` retains the application session, its `AccountHandle` and client.
- `createFinanceRestoreSession` opens a separate database using that handle and
  `driver: { type: 'persistent', dbName: 'restore-' + operationId }`.
- That restore chart owns acquisition, transaction/write custody, settlement and
  `shutdown({ waitForSync: true })`. It releases private archive/planning material
  only after its own client closes. Its durable journal distinguishes incomplete,
  conflicting, cancelled, invalidated and completed operations.
- The application readiness chart already requests restore `DRAIN` before its
  controlled identity changes and session close. The restore controller also
  observes external session changes and sends `SCOPE_CHANGED`.

Consequently, replacing `snapshot.account.id` with `snapshot.user.accountId` is
insufficient. Metadata cannot open the independent restore database.

The published alpha.65 package inspected for U1/U2a has these concrete boundaries:

| Published source                                                     | Observed behavior                                                                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dist/client/index.d.ts`                                             | Exports `JazzUser` and session methods, but no public `AccountHandle`.                                                                                                          |
| `dist/removed-api.js` / `.d.ts`                                      | The old top-level `createDb` is a throwing removed-API stub; its replacement is `createJazzClient(config)` and `session.db`.                                                    |
| `dist/local-first/index.d.ts`, `dist/runtime/default-create-db.d.ts` | The loader's `createClient` still requires `AccountDbConfig.account`; it is not an account-ID-based replacement for the restore acquisition.                                    |
| `dist/session/jazz-session.d.ts`                                     | Public device-key export/restore is available. There is no equivalent export of a backend user's account handle.                                                                |
| `dist/session/state.js`                                              | Replacement marks the old Db replaced and shuts the old client down. Framework acknowledgements are bounded at five seconds; they are not a financial-operation drain contract. |

These are inspected package sources, not a claim that the alternative below is
already qualified. The reproducible exact-version download/integrity check is in
[the upgrade proof](../../tests/worker-upgrade/README.md).

## Recommended direction to discuss

Use the existing application session's `db` for restore. Keep the existing
restore transaction/journal machine as the domain owner, and keep the application
session owner responsible for the Db lifetime. This removes the separate restore
client instead of rebuilding opaque-account access or adding an SDK patch.

Proposed ownership and outcomes, before implementation:

1. Admit the restore against the current ready session, public user binding,
   client and Db. Derive its operation identity exactly as today; account-ID
   equality alone cannot authorize a replacement binding.
2. Keep archive validation, the durable restore journal, conflict comparison,
   transaction ownership and selected write identity in the existing restore
   charts. Keep explicit remote reads where the existing comparison requires
   them; a locally empty replica is not proof of remote absence.
3. For app-controlled restore/recovery/shutdown, the application owner waits for
   restore `DRAIN` and transaction/write settlement before changing or closing
   the native session. Restore releases its operation resources, not the shared Db.
4. For an external native session replacement, reject new work on the retired
   binding and invalidate the restore. Preserve the existing operation ID,
   journal and uncertain outcome instead of replaying a write or reporting a
   rollback that has not been observed.
5. Release archive bytes and planning resources after the operation's actual
   native obligations settle. A session status notification, provider teardown
   or five-second framework acknowledgement is not settlement evidence.

The changed resource boundary needs approval and native qualification: the old
implementation isolates restore in its own database; the proposed version shares
the application's replica and follows the native session's replacement behavior.
Do not silently replace `close` with a no-op adapter or remove the existing
financial drain stages to make the types pass.

The other direction is to retain an independent restore session through supported
public SDK APIs. That would need a separately owned session and a verified way to
select the same account without altering the application's selection. Device-key
export alone does not establish a backend-user solution. This direction is not
implemented or qualified and adds lifetime/selection work; inspect it only if
the independent restore client remains a product requirement. Do not reach into
private SDK modules or introduce a patch as the default solution.

## Qualification required before adopting the replacement

- Restore and conflict comparison through the actual Finance schema and public
  native session, including a non-empty application replica.
- Same-account replacement and A → B → A: the old binding never resumes work.
- Cancellation, controlled identity change and shutdown during acquisition,
  transaction staging, issued commit and local/global settlement.
- External replacement with an open transaction and with an issued write:
  inspect actual SDK outcomes and retain the journal's uncertain result.
- Offline interruption/restart/resume: reuse the existing operation identity;
  never duplicate financial records or treat local persistence as remote acceptance.
- Actual transaction rollback/settlement and resource release in Chromium,
  Firefox and WebKit. Do not claim that U1/U2a's smaller fixture proves this.

## Remaining caller work and order

Resolve this ownership decision before retiring Finance's opaque-account restore
plumbing. Then adapt the coordinated candidate and qualify it before changing
workspace pins:

1. Shared native session adapters are already qualified by U2a.
2. Adopt `initial: 'device'` plus `localFirst: 'now'` in Finance and Clipper;
   remove only their redundant SDK-upgrade leaves/states, preserving acquisition
   custody, domain bootstrap and domain drains.
3. Use `JazzProvider` with its native `loading` snippet. Remove the retired
   `autoAttachDevTools` prop rather than passing `false`.
4. Port identity callers to public `user.accountId`/`kind`, including Finance
   routes, workspace/account/sample integrations and restore binding checks.
   Financial ledger `account` fields are unrelated and must remain unchanged.
5. Preserve native Svelte context: alpha.65 `getJazzSession()` already returns
   a readable store with bound session actions. Keep existing
   `fromStore(getJazzSession())` callers; do not wrap it in `sessionState()`.
   `sessionState(nativeSession)` is for a session facade owned outside that
   context. Imperative facade subscribers receive zero arguments and no initial
   notification; the native Svelte store publishes the initial snapshot.
6. Port Clipper's host to native create/restore/sign-out and public user binding.
   Keep extension sign-in limited to existing accounts and preserve its separate
   provider sign-out request, private library bootstrap and capture drains.

U2 remains incomplete. U3 schema history, U4 authentication/retained destinations
and U5 coherent workspace qualification remain required by the
[upgrade plan](worker-jazz-upgrade-plan.md).
