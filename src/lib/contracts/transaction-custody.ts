/** Native receipts handed to a host whose lifetime outlasts the stopped workflow.
 * Await pending/acquisition before recovery; commit presence means rollback safety is unproven.
 * Keep these objects private and never serialize them.
 */
export type DetachedTransaction<Transaction, Commit> = Readonly<{
	acquisition: Promise<Transaction>
	pending: Promise<unknown> | undefined
	commit: Promise<Commit> | undefined
}>
/** Total synchronous custody transfer, not a cleanup operation or fire-and-forget retry. */
export type RetainDetachedTransaction<Transaction, Commit> = (
	custody: DetachedTransaction<Transaction, Commit>
) => void
