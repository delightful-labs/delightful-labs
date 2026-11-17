# Disposable CI investigation assets

This branch is an investigation runner, not a merge candidate. The ordinary
Finance workflow and translation plugin remain unchanged on PR46.

The archive copies existing public UI/Local First builds and Finance catalogs
from the isolated worker qualification checkout. No catalog is regenerated.
Local First/UI source and catalog inputs are unchanged between its committed
foundation and PR46 head `4916a48a`. The unadopted sign-out prototype is excluded.

Extract before the frozen install with scripts disabled. Public injected-package
links are checked before running the original offline-edit tests. The diagnostic
Vite config omits the generation plugin because these catalogs already exist.
The Ubuntu/browser/Node/pnpm versions and two test workers match Finance CI.
Tracing is enabled for every case; the batch stops on its first failure, with
no retries and at most ten executions of each original case.

The readback is a live client's local observation after an unconfirmed save.
It is not a cold-restart durability proof or authority acceptance. It reports
only comparison booleans and link counts, and issues no financial writes.

Archive SHA-256: `f9a25ff02c88a86eb2b8c9ee092c68523bb0899bcb96d591636f2facd4281db7`.
