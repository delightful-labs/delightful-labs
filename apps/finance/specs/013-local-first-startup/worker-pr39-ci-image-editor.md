# PR #39 image-editor CI fixture correction

The uploaded F4c2 checkpoint `e4a3bf28` failed one of 92 cases in Finance's
[application-2 browser job](https://github.com/delightful-labs/delightful-labs/actions/runs/43645800845/job/132605926823).
The new F4c3 callback owner was still local and is absent from that hosted commit.
All other selected PR #39 checks passed, including Local First consumers/native
qualification, Clipper browser/worker/offline/extension suites and Finance PWA.

## Observed failure

`transaction-image-editor.e2e.ts` timed out at its first editor opening in the
saved-perspective/offline-grayscale case. The preview dialog became visible and
its image/heading assertions passed. Before the next Edit Image click could find
the dialog's button, the transaction form reset replaced the image-picker subtree
and removed the dialog. The final page had the saved image and a disabled
Save Transaction button. This differs from PR #37's incomplete database snapshot
failure, whose complete file/parts assertion passed here.

The trace shows the selected file input still populated/disabled after Save,
followed by a reset input and editable form while Save Transaction remained
enabled. The preview opened during that intermediate state. The screencast then
shows its removal during the final draft reset. `TransactionEditEntry.svelte`
increments `attachmentPickerRevision` for both completed submission feedback
and a changed draft revision; `TransactionForm.svelte` keys the entire image-input
subtree, including saved previews, by that revision.

## Fixture change

After clicking Save, `uploadSaved` waits for the existing Transaction saved
status, an empty enabled native upload input, and the complete file/parts baseline.
It then reloads the detail, waits for editable controls and the saved image, and
compares the restored metadata/identity/bytes to that baseline before editing.
The saved-image scenarios therefore start from a persisted detail rather than
an earlier form's transient completion/remount. Existing exact cancel, offline
replacement, download and viewer assertions remain. No application behavior,
timeout or assertion retry-until-equality changes.

The first local attempt incorrectly used Save Transaction becoming disabled as
its completion signal. It passed three cases and failed the other six at that
new assertion: this form can keep Save enabled after saving. Source/fixture
inspection replaced that assumption with the existing completion status and
verified persisted baseline above. The first-attempt log is retained; its errors
are not attributed to application behavior or the worker contracts.

This corrects an existing test's saved-state setup. Its application paths are
already reviewed; the browser cases do not import/execute the local F4c3 owner
awaiting separate implementation/test approval. No F4c3 test is run or claimed
by this qualification.

## Evidence and verification

Original hosted result: 91 pass, one failure. Artifact `14135150067` is preserved
at `/private/tmp/pr39-image-editor-failure.zip`; extracted trace, error context,
failure screenshot and intermediate screencast frames use the same prefix.
The original job was not blindly retried. Local verification uses the isolated
worktree's disposable app/Jazz fixture on port 5198, preserving the user's
5173/5174 environment and all unidentified listeners.

Final verification passes on 2026-11-14 with Node 24.22.2/pnpm 10.28.0:

- `pnpm check:tests`: strict browser-fixture types pass.
- `FINANCE_E2E_PORT=5198 pnpm exec playwright test tests/transaction-image-editor.e2e.ts --project=application --workers=2 --repeat-each=3`:
  all nine cases pass in 22.2 seconds, including keyboard editing, persisted
  saved-image cancellation/offline editing/download and viewer restrictions.
- `FINANCE_E2E_PORT=5198 pnpm exec playwright test --project=application --shard=2/2 --workers=2`:
  all 92 cases pass in 2.5 minutes, matching the failed CI selection.
- Changed-file formatting, shared guidance and whitespace checks pass.

Logs use `/private/tmp/pr39-image-editor-fixture-*.log`; the final focused log
ends in `repeat-final.log` and the shard log ends in `application2.log`. Local
verification qualifies the fixture correction; the new hosted run must still
pass. The disposable server has exited. User servers/data are preserved.
