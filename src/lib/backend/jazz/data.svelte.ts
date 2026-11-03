import {
	QuerySubscription as NativeQuerySubscription,
	QuerySubscriptionOne as NativeQuerySubscriptionOne
} from 'jazz-tools/svelte'
import { ReadTier } from 'jazz-tools'
type SubscriptionOptions = ConstructorParameters<typeof NativeQuerySubscription<{ id: string }>>[1]
function localFirstOptions(options: SubscriptionOptions) {
	return () => {
		const supplied = typeof options === 'function' ? options() : options
		return { tier: ReadTier.LocalFirst, ...supplied }
	}
}
/** The native schema/query stays consumer-owned. Foreground subscriptions default to local-first.
 * Explicit caller tiers remain explicit for authority/acquisition flows. Create inside the owning component.
 */
export class QuerySubscription<Row extends { id: string }> extends NativeQuerySubscription<Row> {
	constructor(...[query, options]: ConstructorParameters<typeof NativeQuerySubscription<Row>>) {
		super(query, localFirstOptions(options))
	}
}
export class QuerySubscriptionOne<
	Row extends { id: string }
> extends NativeQuerySubscriptionOne<Row> {
	constructor(...[query, options]: ConstructorParameters<typeof NativeQuerySubscriptionOne<Row>>) {
		super(query, localFirstOptions(options))
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
