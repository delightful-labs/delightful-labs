# Quickstart: Manual SimpleFIN Bank Sync

1. Open bank sync settings as an organization owner/admin.
2. Paste a SimpleFIN Bridge setup token and choose Create passkey. After creation, follow the separate Test encryption and Test unlocking views, each with its own explanation and explicit button. Once both pass, choose Connect and save securely to claim the token and persist the encrypted credential. Cancel returns to the form and discards pending setup data.
3. Connection finishes locked; no provider data is fetched.
4. Explicitly discover accounts and verify the passkey. For each discovered account, use Add account to create and link a local bank account with the provider’s name and currency. When active local accounts exist, optionally link to an existing account instead.
5. Press Sync now and verify the passkey for one transaction import. Review counts and outcome. Failures never retry automatically.
6. On another compatible device, sign into the same Jazz identity, wait for ciphertext replication and use the same synced passkey. Do not claim another token merely to unlock.
7. If the original passkey is lost, reconnect using a new setup token and passkey. Existing finance data remains. Disconnect also requires provider-side revocation to invalidate previously copied credentials.

Physical-device compatibility is not yet certified. HTTPS with a stable hostname (localhost for development) is required. Tests await implementation review; never use real provider credentials in fixtures or logs.

## Standalone passkey demo

Open `/settings/passkey-demo` to exercise the explanatory XState views with arbitrary dummy text. This page creates a real demo passkey, encrypts the text, and verifies decryption only after explicit actions. It never validates a SimpleFIN token, calls the relay/provider, or writes finance data or credentials to Jazz. All sample data and usable key references are released on completion, cancellation, or navigation. The passkey remains in the password manager until removed there. Use this page for UI and encryption experiments; the bank settings route retains the real provider integration.
