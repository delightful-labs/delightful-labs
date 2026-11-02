import {
	QuerySubscription as NativeQuerySubscription,
	QuerySubscriptionOne as NativeQuerySubscriptionOne
} from 'jazz-tools/svelte'
import { ReadTier } from 'jazz-tools'
/** The native schema/query stays consumer-owned. Foreground subscriptions default to local-first.
 * Explicit caller tiers remain explicit for authority/acquisition flows. Create inside the owning component.
 */
export class QuerySubscription<Row extends { id: string }> extends NativeQuerySubscription<Row> {
	constructor(...[query, options]: ConstructorParameters<typeof NativeQuerySubscription<Row>>) {
		super(query, () => {
			const supplied = typeof options === 'function' ? options() : options
			return { tier: ReadTier.LocalFirst, ...supplied }
		})
	}
}
export class QuerySubscriptionOne<
	Row extends { id: string }
> extends NativeQuerySubscriptionOne<Row> {
	constructor(...[query, options]: ConstructorParameters<typeof NativeQuerySubscriptionOne<Row>>) {
		super(query, () => {
			const supplied = typeof options === 'function' ? options() : options
			return { tier: ReadTier.LocalFirst, ...supplied }
		})
	}
}
/** Issue and settlement are separate leaves. A local receipt never implies remote acceptance. */
export function issueLocalWrite<Receipt>(issue: () => Receipt): { write: Receipt } {
	return { write: issue() }
}
export function persistLocal(write: {
	wait: (options: { tier: 'local' }) => PromiseLike<unknown>
}): Promise<void> {
	return Promise.resolve(write.wait({ tier: 'local' })).then(() => undefined)
}
