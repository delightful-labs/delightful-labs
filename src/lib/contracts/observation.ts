/** Read row fields inside the integration's reactive effect, before actor.send is untracked.
 * Jazz merges subscription deltas in place. Copying also keeps revisioned facts immutable.
 * Opaque bindings and resource handles must retain their own identities.
 */
export function observeRow<Row extends object>(
	row: Row | null | undefined
): Row | null | undefined {
	return row == null ? row : { ...row }
}
export function observeRows<Row extends object>(
	rows: readonly Row[] | null | undefined
): readonly Row[] {
	return rows?.map((row) => ({ ...row })) ?? []
}

/** Loading and failure never collapse into an authoritative empty observation. */
export type DataObservation<Row> =
	| { status: 'loading'; revision: number }
	| { status: 'failed'; revision: number; error: unknown }
	| { status: 'available'; revision: number; rows: readonly Row[] }
