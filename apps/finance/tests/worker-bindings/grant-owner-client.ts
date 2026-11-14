import { createActor } from 'xstate'
import {
	brokerHostCall,
	type brokerHostClient,
	type BrokerHostOperation,
	type BrokerHostReply
} from 'delightful-local-first/backend/jazz/worker-broker'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'
import type { FinanceGrantDescriptor } from '../../src/lib/runtime/worker/grant-binding.js'
import type { FinanceGrantOwnerReport } from '../../src/lib/machines/runtime/worker-grant-contracts.js'
import { createGrantFixtureParent } from './grant-owner-parent.js'

/** Browser fixture facade only. Window already supplied these actual ports;
 * production acquisition routing/population is intentionally not simulated. */
export function createGrantOwnerFixture(
	data: MessagePort,
	control: MessagePort,
	scope: string,
	descriptor: FinanceGrantDescriptor,
	retireBeforeReply: boolean,
	onReport: (report: FinanceGrantOwnerReport) => void,
	onPost: () => void
): ReturnType<typeof brokerHostClient> {
	const identity = {
		runtimeId: crypto.randomUUID(),
		grantId: scope,
		acquisitionId: crypto.randomUUID()
	}
	const close = { scope, requestId: crypto.randomUUID() }
	const ready = {
		version: 1,
		...identity,
		type: 'GRANT_READY',
		dataPort: data,
		controlPort: control
	} satisfies import('../../src/lib/runtime/worker/grant-protocol.js').FinanceGrantReply
	const actor = createActor(createGrantFixtureParent(), {
		input: {
			configuration: () => ({
				request: { version: 1, ...identity, type: 'ACQUIRE_GRANT', descriptor },
				origin: location.origin,
				closeRequestId: close.requestId,
				acquisitionTimeoutMs: 5000,
				requestTimeoutMs: 5000,
				closeTimeoutMs: 5000,
				postAcquire: () => {
					onPost()
					if (!retireBeforeReply) actor.send({ type: 'GRANT_REPLY', reply: ready })
					return { kind: 'posted' }
				}
			}),
			onReport
		}
	})
	const closure = Promise.withResolvers<WorkerHostClosed>()
	void closure.promise.catch(() => {})
	actor.subscribe({
		complete() {
			const output = actor.getSnapshot().output
			if (output?.kind === 'closed') closure.resolve(output.receipt)
			else closure.reject(new Error('Grant fixture ended without a native receipt'))
		},
		error: () => closure.reject(new Error('Grant fixture failed'))
	})
	actor.start()
	if (retireBeforeReply) {
		actor.send({ type: 'RETIRE' })
		actor.send({ type: 'GRANT_REPLY', reply: ready })
	}
	function call(operation: BrokerHostOperation) {
		if (actor.getSnapshot().status !== 'active')
			return Promise.reject(
				Object.assign(new Error('Grant fixture closed'), { workerEffectOutcome: 'not-issued' })
			)
		return new Promise<BrokerHostReply>((resolve, reject) =>
			actor.send({
				type: 'REQUEST',
				call: brokerHostCall(crypto.randomUUID(), operation, (result) => {
					if (result.kind === 'succeeded') resolve(result.response)
					else
						reject(
							Object.assign(new Error('Grant fixture refused'), {
								workerEffectOutcome: result.effectOutcome
							})
						)
				})
			})
		)
	}
	return {
		host: { identity: close, closed: closure.promise },
		async open(url, name) {
			const reply = await call({ type: 'OPEN', url, name })
			if (reply.type !== 'OPENED') throw new Error('Missing grant fixture SDK port')
			return { port: reply.port }
		},
		async readGeneration(key) {
			const reply = await call({ type: 'READ', key })
			if (reply.type !== 'RESULT') throw new Error('Missing grant fixture generation result')
			return reply.value
		},
		async writeGeneration(key, value) {
			await call({ type: 'WRITE', key, value })
		},
		close() {
			if (actor.getSnapshot().status === 'active') actor.send({ type: 'RETIRE' })
			return closure.promise
		},
		dispose() {
			actor.stop()
			closure.reject(new Error('Grant fixture disposed'))
		}
	}
}
