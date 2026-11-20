# AT Protocol login

Finance uses Local First's optional AT Protocol authentication with Better Auth
and the native Jazz adapter. Clipper consumes the same implementation, with its
own publication policy. Finance requests exactly `atproto`; it does not request
repository publication grants or publish financial data.

## Server configuration

| Setting         | Value                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_BASE_URL` | The exact app origin, with no path, query, credentials or fragment. Use a stable HTTPS origin for hosted login. HTTP is accepted only for `127.0.0.1` and `localhost`. |
| `AUTH_SECRET`   | A private random secret of at least 32 characters. Keep it stable across restarts and deployments of the same environment.                                             |

These are server process environment variables, without a `PUBLIC_` prefix.
The integration reads `process.env`; supply them to the Node process or through
the hosting environment. Do not assume a Vite `.env.local` entry alone configures
these process variables. Missing or invalid configuration returns a sanitized
503 auth response; ordinary local-first startup remains available.

For disposable local verification, use the monorepo's isolated worktree and
Finance's `dev:agent` command with an unused port. Supply `AUTH_SECRET` privately
in the process environment, then start from the monorepo root, for example:

```sh
AUTH_BASE_URL=http://127.0.0.1:5182 pnpm --filter delightful-finances dev:agent --port 5182
```

Open `http://127.0.0.1:5182` in a disposable browser profile. Use that same hostname
throughout the round trip: the provider plugin uses `127.0.0.1` for loopback
redirects, and `localhost` has different cookies and browser storage. Agent backend
storage is in memory and will disappear when the server stops. A hosted HTTPS
preview is the preferred environment for the outstanding real-provider check.

For a preview, configure its stable branch origin and a separate secret in the
preview environment. Retain its isolated Jazz store. The provider must be able to
fetch the metadata URL without dashboard authentication; an authenticated browser
does not prove provider access. Any hosting protection change or deployment needs
its own explicit authorization.

## Routes and storage

The server exposes these routes under the configured app origin:

- `/api/auth/oauth-client-metadata.json`: provider-readable OAuth client metadata.
- `/api/auth/atproto/callback`: the provider's authorization callback.
- `/?atproto_attempt=…`: the app return URL, confirmed by a signed, short-lived
  completion receipt before removing its attempt parameter.

Finance uses the `finance.auth` auth-cookie prefix and the separate
`finance.oauth-completion` receipt cookie. Sharing an AT Protocol identity with
Clipper does not share an app session or authorize access to either app's data.

The six auth tables live in Finance's existing Jazz store and deny all client
CRUD. The additive native migration preserves the existing financial tables and
identity data. Keep the generated schema, migration and snapshot together.
Normal backend startup publishes them; no separate auth database or data reset
is needed. Keep existing production storage configuration unchanged when adopting
login. Removing auth tables is not a safe rollback after users have linked accounts.

## Account behavior

A device account requires confirmation before login. Jazz links a new provider
user to the current local account; an existing provider user opens that user's
account. The previous account remains recoverable with its recovery phrase.
Accounts and workspaces are never automatically merged. Save the local account's
phrase before switching if you will need to reopen it.

Before provider navigation, Finance drains financial operations and waits for
native session, account-store and broker closure. Sign-out drains first, clears
the app's provider session, then performs native logout. It does not sign out the
provider account globally.

Recovery from a backend-authenticated account or an unresolved callback clears
the provider app session before restoring the phrase's identity. If that required
clearance is unavailable, recovery refuses to switch identities. Guest recovery
without provider-session evidence keeps its existing offline behavior. Remembered
local identities and local edits remain usable offline without a provider cookie.

## Real-provider verification still required

Use an isolated preview, disposable Finance data and an account selected by the
owner. Record only pass/fail results and non-sensitive configuration facts.

1. Fetch the metadata anonymously. Check the Finance client name, `atproto` scope,
   metadata URL and callback origin. Confirm no publication grant appears.
2. Create local sample work and save its recovery phrase privately. Start login,
   cancel confirmation once, then retry and confirm. Check keyboard focus returns
   to the login control after canceling.
3. Complete provider consent. Verify the app returns to the same configured
   origin, confirms the callback and removes the attempt parameter. Reload and
   verify the same native account and its expected workspace data.
4. In a second disposable profile with different local work, log in to the same
   provider account. Confirm the switch notice, the existing provider account's
   data and isolation from the second profile's previous wallet.
5. Sign out and log in again. Recover the previous local account using its saved
   phrase and verify its data. Reload to confirm the old provider app session does
   not replace the restored identity.
6. Close every app client and restart the browser offline. Verify the same local
   account opens, create an offline entry, restart again, and reconnect. Confirm
   the entry survives and syncs to that account.

Local native/browser tests already cover these app boundaries with a synthetic
provider redirect and real Jazz, cookies and completion receipts. They do not
establish real-provider consent or OAuth interoperability. The current evidence
is recorded in the [feature spec](../../../specs/004-finance-atproto-login/spec.md).
