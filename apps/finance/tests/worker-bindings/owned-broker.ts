import { createActor, setup, types, type ActorRefFrom } from 'xstate'
import {
	createBrokerHostChannel,
	brokerHostChannelInput,
	brokerHostCall,
	type brokerHostClient,
	type BrokerHostCall,
	type BrokerHostChannelInput,
	type BrokerHostOperation,
	type BrokerHostReply
} from 'delightful-local-first/backend/jazz/worker-broker'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'

// Disposable native fixture parent, not the Finance application/session owner.
const channel = createBrokerHostChannel()
const parent = setup({
	schemas: {
		context: types<{ input: BrokerHostChannelInput; receipt: WorkerHostClosed | undefined }>(),
		input: types<BrokerHostChannelInput>(),
		output: types<WorkerHostClosed | undefined>(),
		events: { CALL: types<{ call: BrokerHostCall }>(), CLOSE: types() },
		children: { channel: types<ActorRefFrom<typeof channel>>() }
	},
	actors: { channel }
}).createMachine({
	id: 'native-owned-broker-fixture',
	initial: 'owning',
	context: ({ input }) => ({ input, receipt: undefined }),
	output: ({ context }) => context.receipt,
	states: {
		owning: {
			invoke: {
				id: 'channel',
				src: 'channel',
				input: ({ context }) => context.input,
				onDone: ({ event }) => ({ target: 'closed', context: { receipt: event.output } }),
				onError: { target: 'failed' }
			},
			on: {
				CALL: ({ event }, enq) => enq.sendTo('channel', { type: 'REQUEST', call: event.call }),
				CLOSE: (_, enq) => enq.sendTo('channel', { type: 'CLOSE' })
			}
		},
		closed: { type: 'final' },
		failed: { type: 'final' }
	}
})
export function createOwnedBrokerFixture(
	data: MessagePort,
	control: MessagePort,
	scope: string
): ReturnType<typeof brokerHostClient> {
	const identity = { scope, requestId: crypto.randomUUID() }
	const actor = createActor(parent, {
		input: brokerHostChannelInput(data, control, identity, {
			onOverdue: () => {},
			onBlocked: () => {}
		})
	})
	let resolveClose!: (receipt: WorkerHostClosed) => void
	let rejectClose!: (error: Error) => void
	const closed = new Promise<WorkerHostClosed>((resolve, reject) => {
		resolveClose = resolve
		rejectClose = reject
	})
	void closed.catch(() => {})
	actor.subscribe({
		complete() {
			const receipt = actor.getSnapshot().output
			if (receipt) resolveClose(receipt)
			else rejectClose(new Error('Fixture parent stopped without a close receipt'))
		},
		error() {
			rejectClose(new Error('Fixture parent failed'))
		}
	})
	actor.start()
	function call(operation: BrokerHostOperation) {
		if (actor.getSnapshot().status !== 'active')
			return Promise.reject(
				Object.assign(new Error('Fixture grant closed'), { workerEffectOutcome: 'not-issued' })
			)
		return new Promise<BrokerHostReply>((resolve, reject) =>
			actor.send({
				type: 'CALL',
				call: brokerHostCall(crypto.randomUUID(), operation, (result) => {
					if (result.kind === 'succeeded') resolve(result.response)
					else
						reject(
							Object.assign(new Error('Fixture grant refused'), {
								workerEffectOutcome: result.effectOutcome
							})
						)
				})
			})
		)
	}
	return {
		host: { identity, closed },
		async open(url, name) {
			const reply = await call({ type: 'OPEN', url, name })
			if (reply.type !== 'OPENED') throw new Error('Fixture broker port missing')
			return { port: reply.port }
		},
		async readGeneration(key) {
			const reply = await call({ type: 'READ', key })
			if (reply.type !== 'RESULT') throw new Error('Fixture generation result missing')
			return reply.value
		},
		async writeGeneration(key, value) {
			await call({ type: 'WRITE', key, value })
		},
		close() {
			if (actor.getSnapshot().status === 'active') actor.send({ type: 'CLOSE' })
			return closed
		},
		dispose() {
			actor.stop()
			rejectClose(new Error('Fixture parent disposed'))
		}
	}
}
