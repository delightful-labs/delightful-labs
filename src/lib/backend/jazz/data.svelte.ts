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
export function createQuerySubscription<Row extends { id: string }>(
	...[query, options]: ConstructorParameters<typeof NativeQuerySubscription<Row>>
) {
	return new NativeQuerySubscription<Row>(query, localFirstOptions(options))
}
export function createQuerySubscriptionOne<Row extends { id: string }>(
	...[query, options]: ConstructorParameters<typeof NativeQuerySubscriptionOne<Row>>
) {
	return new NativeQuerySubscriptionOne<Row>(query, localFirstOptions(options))
}
/** Preserve the original constructor API while delegating ownership to native SDK instances. */
export const QuerySubscription = new Proxy(NativeQuerySubscription, {
	construct<Row extends { id: string }>(
		_target: typeof NativeQuerySubscription,
		args: ConstructorParameters<typeof NativeQuerySubscription<Row>>
	) {
		return createQuerySubscription<Row>(...args)
	}
})
export type QuerySubscription<Row extends { id: string }> = NativeQuerySubscription<Row>
export const QuerySubscriptionOne = new Proxy(NativeQuerySubscriptionOne, {
	construct<Row extends { id: string }>(
		_target: typeof NativeQuerySubscriptionOne,
		args: ConstructorParameters<typeof NativeQuerySubscriptionOne<Row>>
	) {
		return createQuerySubscriptionOne<Row>(...args)
	}
})
export type QuerySubscriptionOne<Row extends { id: string }> = NativeQuerySubscriptionOne<Row>
/** Issue and settlement are separate leaves. A local receipt never implies remote acceptance. */
export function issueLocalWrite<Receipt>(issue: () => Receipt): { write: Receipt } {
	return { write: issue() }
}
export function persistLocal(write: {
	wait: (options: { tier: 'local' }) => PromiseLike<unknown>
}): Promise<void> {
	return Promise.resolve(write.wait({ tier: 'local' })).then(() => undefined)
}
