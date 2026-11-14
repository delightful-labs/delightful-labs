import type { WorkerChannelResult } from '../contracts/worker-channel.js'

/** Owner-selected interruption without a fabricated broker wire identity. */
export type WorkerCallbackInterruption = Readonly<{
	kind: 'interrupted'
	reason: 'closed' | 'unavailable'
	effectOutcome: 'not-issued' | 'unknown'
}>
export type WorkerCallbackResult<
	Response,
	Interruption extends WorkerCallbackInterruption = never
> = WorkerChannelResult<Response> | Interruption
export type WorkerCallbackStopResult<
	Response,
	Interruption extends WorkerCallbackInterruption = never
> = Exclude<WorkerCallbackResult<Response, Interruption>, { kind: 'succeeded' }>
export type WorkerCallbackRegistration<
	Identity,
	Response,
	Interruption extends WorkerCallbackInterruption = never
> = Readonly<{
	identity: Identity
	settle: (result: WorkerCallbackResult<Response, Interruption>) => void
	/** Selected by the owning chart before registration; stop chooses no outcome. */
	stopped: WorkerCallbackStopResult<Response, Interruption>
}>
export type WorkerCallbackCustody<
	Identity,
	Response,
	Interruption extends WorkerCallbackInterruption = never
> = Readonly<{
	register: (observer: WorkerCallbackRegistration<Identity, Response, Interruption>) => void
	/** Record the chart's conservative stop result before selected dispatch. */
	recordStopResult: (
		identity: Identity,
		result: WorkerCallbackStopResult<Response, Interruption>
	) => void
	capture: (response: Response) => object | undefined
	discard: (token: object) => void
	deliver: (
		identity: Identity,
		result: WorkerCallbackResult<Response, Interruption>,
		token: object | undefined
	) => void
	/** Disruptive native cleanup only; never an SDK or host-close receipt. */
	stop: () => void
}>

/** A successful observer return accepts response custody. A throwing observer
 * did not accept it. This leaf neither selects nor changes the supplied result. */
export function deliverWorkerCallback<
	Response,
	Interruption extends WorkerCallbackInterruption = never
>(
	settle: (result: WorkerCallbackResult<Response, Interruption>) => void,
	result: WorkerCallbackResult<Response, Interruption>,
	discard: (response: Response) => void
) {
	try {
		settle(result)
	} catch {
		if (result.kind === 'succeeded') discard(result.response)
	}
}

/** Native observer/resource bookkeeping extracted from the worker channel.
 * Call only from selected effects/native callbacks, never guards/calculations.
 * The owning chart bounds registration and chooses correlation, dispatch,
 * settlement and graceful close. This factory starts no actor or listener. */
export function createWorkerCallbackCustody<
	Identity,
	Response,
	Interruption extends WorkerCallbackInterruption = never
>(
	input: Readonly<{
		sameIdentity: (left: Identity, right: Identity) => boolean
		discard: (response: Response) => void
	}>
): WorkerCallbackCustody<Identity, Response, Interruption> {
	const { sameIdentity, discard: discardResponse } = input
	const resources = new Map<object, { response: Response }>()
	const observers = new Set<WorkerCallbackRegistration<Identity, Response, Interruption>>()
	let stopped = false
	let stopFailure: AggregateError | undefined

	function discard(token: object) {
		const captured = resources.get(token)
		if (!captured) return
		resources.delete(token)
		try {
			discardResponse(captured.response)
		} catch (error) {
			resources.set(token, captured)
			throw error
		}
	}
	return Object.freeze({
		register(observer: WorkerCallbackRegistration<Identity, Response, Interruption>) {
			if (stopped) {
				deliverWorkerCallback<Response, Interruption>(
					observer.settle,
					observer.stopped,
					discardResponse
				)
				return
			}
			if ([...observers].some((existing) => sameIdentity(existing.identity, observer.identity)))
				throw new Error('Duplicate worker callback registration')
			observers.add({ ...observer, stopped: { ...observer.stopped } })
		},
		recordStopResult(identity: Identity, result: WorkerCallbackStopResult<Response, Interruption>) {
			const observer = [...observers].find((candidate) =>
				sameIdentity(candidate.identity, identity)
			)
			if (!observer) return
			observers.delete(observer)
			observers.add({ ...observer, stopped: { ...result } })
		},
		capture(response: Response) {
			const token = {}
			resources.set(token, { response })
			if (stopped) {
				discard(token)
				return undefined
			}
			return token
		},
		discard,
		deliver(
			identity: Identity,
			result: WorkerCallbackResult<Response, Interruption>,
			token: object | undefined
		) {
			const observer = [...observers].find((candidate) =>
				sameIdentity(candidate.identity, identity)
			)
			if (!observer) return
			// Relinquish before calling out: reentrant stop cannot settle the same
			// callback twice or reclaim a port that the SDK is accepting.
			observers.delete(observer)
			const failures: unknown[] = []
			try {
				if (token) {
					if (result.kind === 'succeeded') resources.delete(token)
					else discard(token)
				}
			} catch (error) {
				failures.push(error)
			}
			// Even a failed native disposer cannot strand this callback after its
			// registration has been detached. Surface failures after delivery.
			try {
				deliverWorkerCallback<Response, Interruption>(observer.settle, result, discardResponse)
			} catch (error) {
				if (result.kind === 'succeeded') resources.set(token ?? {}, { response: result.response })
				failures.push(error)
			}
			if (failures.length) throw new AggregateError(failures, 'Worker callback delivery failed')
		},
		stop() {
			if (stopped) {
				if (stopFailure) throw stopFailure
				return
			}
			stopped = true
			// Detach observers before disposing resources/calling out. Each already
			// registered observer receives its chart-selected stop result once.
			const pending = [...observers]
			observers.clear()
			const failures: unknown[] = []
			// Snapshot before disposal: a failing disposer reinserts its resource.
			const retainedTokens = Array.from(resources.keys())
			try {
				for (const token of retainedTokens) {
					try {
						discard(token)
					} catch (error) {
						failures.push(error)
					}
				}
			} finally {
				for (const observer of pending)
					deliverWorkerCallback<Response, Interruption>(
						observer.settle,
						observer.stopped,
						discardResponse
					)
			}
			if (failures.length) {
				stopFailure = new AggregateError(failures, 'Worker callback resource disposal failed')
				throw stopFailure
			}
		}
	})
}
