# Account merge interaction contract

The existing recovery-phrase form gains a source-data summary and Merge local data / Use connected account only choices, plus Cancel. All strings use Paraglide; reuse existing controls and visual conventions. Never show secret phrases in summaries or logs.

Before switching: show counts, source workspace, scope of copied records and excluded bank connections. Invalid phrases leave the current identity unchanged. After successful target readiness: show destination workspace, additions/existing/conflicts and require Confirm import before finance writes. Cancellation at this stage leaves the connected identity selected and preserves the source snapshot.

Machine commands: CONNECT with transient phrase and merge/remote-only intent; CANCEL; CONFIRM_IMPORT; RETRY; RESUME; RETURN_TO_SOURCE with transient authentication if required; DISCARD_SNAPSHOT; SHUTDOWN. Observations carry SDK identity/client readiness, workspace bindings, permissions and journal availability. Secrets must be cleared on every terminal path and never included in durable events/logging.

Presentation receives machine-owned availability and result descriptors, counts, conflicts and callbacks. It does not derive readiness from prop combinations or access Jazz. The application owner serializes session replacement and waits for workspace/bank cleanup.

Outcomes: completed locally, partial with committed/skipped/conflict counts, cancelled with whether identity changed and whether additions exist, failed with recovery action. Remote synchronization confirmation is a separate supported fact. No automatic provider calls, automatic retries, destructive rollback or silent source deletion.

On reload, detect a pending journal and offer resume/discard before another merge. Resume requires the journal's exact target identity and destination. Prevent overlapping operations across tabs and state clearly when another tab owns the operation.
