import { describe, expect, it, vi } from 'vitest'
import { createSampleTransactionsMachine } from './sample-transactions.js'
import { creationFixture } from '../transactions/transaction-create.fixture.js'
import { createTransactionEntryFormOptions } from '../transactions/transaction-entry.js'
import type { FormChildEvent, FormOperationResult } from '#lib/contracts/form-contract.js'
import type {
	TransactionEntryObservation,
	TransactionEntryReason
} from '#lib/contracts/transaction-entry-contract.js'
import { createActor, setup, toPromise, waitFor, types } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

describe('sample transaction batches', () => {
	it('saves exactly 25 sequential entries and allows a new batch', async () => {
		const f = creationFixture()
		const indices: number[] = []
		const actor = createActor(
			createSampleTransactionsMachine({
				logic: f.machine,
				prepare: (index) => {
					indices.push(index)
					return f.input()
				},
				result: (output) => output,
				recipient: (actor) => actor
			})
		).start()
		actor.send({ type: 'ADD' })
		actor.send({ type: 'ADD' })
		await waitFor(actor, (s) => s.matches('complete'))
		expect(indices).toEqual(Array.from({ length: 25 }, (_, index) => index))
		expect(f.commit).toHaveBeenCalledTimes(25)
		actor.send({ type: 'ADD' })
		await waitFor(actor, (s) => s.matches('complete'))
		expect(indices).toHaveLength(50)
		expect(actor.getSnapshot().context.saved).toBe(25)
		actor.stop()
	})
	for (const failAt of [0, 4]) {
		it(`stops on failure after ${failAt} saves and retries with a new batch`, async () => {
			const f = creationFixture()
			let fail = true
			const indices: number[] = []
			const actor = createActor(
				createSampleTransactionsMachine({
					logic: f.machine,
					prepare: (index) => {
						indices.push(index)
						if (fail && index === failAt) throw new Error('Invalid sample')
						return f.input()
					},
					result: (output) => output,
					recipient: (actor) => actor
				})
			).start()
			actor.send({ type: 'ADD' })
			await waitFor(actor, (s) => s.matches(failAt ? 'partial' : 'failure'))
			expect(actor.getSnapshot().context.saved).toBe(failAt)
			expect(indices).toHaveLength(failAt + 1)
			fail = false
			actor.send({ type: 'ADD' })
			await waitFor(actor, (s) => s.matches('complete'))
			expect(indices.slice(failAt + 1)).toEqual(Array.from({ length: 25 }, (_, index) => index))
			actor.stop()
		})
	}
	it.each(['CANCEL', 'INVALIDATE', 'SHUTDOWN'] satisfies ('CANCEL' | 'INVALIDATE' | 'SHUTDOWN')[])(
		'drains the issued item on %s and starts no subsequent item',
		async (type) => {
			const f = creationFixture()
			const pending = Promise.withResolvers<void>()
			f.wait.mockReturnValue(pending.promise)
			const actor = createActor(
				createSampleTransactionsMachine({
					logic: f.machine,
					prepare: () => f.input(),
					result: (output) => output,
					recipient: (actor) => actor
				})
			).start()
			actor.send({ type: 'ADD' })
			await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce())
			actor.send({ type })
			expect(actor.getSnapshot().status).toBe('active')
			pending.resolve()
			await waitFor(actor, (s) => s.matches(type === 'SHUTDOWN' ? 'closed' : 'partial'))
			expect(actor.getSnapshot().context.saved).toBe(1)
			expect(actor.getSnapshot().context.lastResult).toMatchObject({
				settlement: 'locallyPersisted'
			})
			expect(f.commit).toHaveBeenCalledOnce()
			actor.stop()
		}
	)
	it('rolls back before staging when shutdown races an item read', async () => {
		const f = creationFixture()
		const read = Promise.withResolvers<[]>()
		f.all.mockReturnValue(read.promise)
		const actor = createActor(
			createSampleTransactionsMachine({
				logic: f.machine,
				prepare: () => f.input({ ...f.input().request.values, tags: ['Garden'] }),
				result: (output) => output,
				recipient: (actor) => actor
			})
		).start()
		actor.send({ type: 'ADD' })
		await vi.waitFor(() => expect(f.all).toHaveBeenCalledOnce())
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		read.resolve([])
		await toPromise(actor)
		expect(actor.getSnapshot().context.saved).toBe(0)
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.commit).not.toHaveBeenCalled()
	})
	it('retains uncertain persistence results in a failed batch', async () => {
		const f = creationFixture()
		f.wait.mockRejectedValue(new Error('Settlement failed'))
		const actor = createActor(
			createSampleTransactionsMachine({
				logic: f.machine,
				prepare: () => f.input(),
				result: (output) => output,
				recipient: (actor) => actor
			})
		).start()
		actor.send({ type: 'ADD' })
		await waitFor(actor, (s) => s.matches('failure'))
		expect(actor.getSnapshot().context.lastResult).toMatchObject({
			outcome: 'partial',
			reason: 'saveUnresolved',
			settlement: 'unknown'
		})
		actor.stop()
	})
	it('refreshes authorization for each item and stops after grants are revoked', async () => {
		const f = creationFixture()
		let facts = f.input().observation.facts
		f.wait.mockImplementation(async () => {
			facts = { ...facts, membership: null }
		})
		const operation = createTransactionEntryFormOptions({
			binding: f.db,
			db: f.db,
			observe: () => facts
		}).operation
		const actor = createActor(
			createSampleTransactionsMachine({
				logic: operation,
				prepare: () => ({
					...f.input(),
					observation: { revision: 0, facts }
				}),
				result: (output) => output,
				recipient: (actor) => actor
			})
		).start()
		actor.send({ type: 'ADD' })
		await waitFor(actor, (s) => s.matches('partial'))
		expect(actor.getSnapshot().context.saved).toBe(1)
		expect(actor.getSnapshot().context.lastResult).toMatchObject({
			outcome: 'denied',
			settlement: 'notStarted'
		})
		expect(f.beginTransaction).toHaveBeenCalledOnce()
		actor.stop()
	})
	it('supervises a crashed creation actor without waiting for an acknowledgement', async () => {
		const f = creationFixture()
		const events0 = {
			INVALIDATE: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'INVALIDATE'>>(),
			CANCEL: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'CANCEL'>>(),
			SHUTDOWN: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'SHUTDOWN'>>(),
			OBSERVE: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'OBSERVE'>>()
		}
		type NativeEvent0 =
			| import('xstate').InferEvents<typeof events0>
			| import('xstate').DoneActorEvent<never>
			| import('xstate').ErrorActorEvent
		const broken = setup({
			schemas: {
				context: types<{}>(),
				events: events0,
				input: types<ReturnType<typeof f.input>>(),
				output: types<FormOperationResult<void, TransactionEntryReason>>()
			}
		}).createMachine({
			context: {},
			entry: () => {
				throw new Error('Actor crashed')
			},
			output: () => ({ outcome: 'succeeded', value: undefined, settlement: 'locallyPersisted' })
		})
		const actor = createActor(
			createSampleTransactionsMachine({
				logic: broken,
				prepare: () => f.input(),
				result: (output) => output,
				recipient: (actor) => actor
			})
		).start()
		actor.send({ type: 'ADD' })
		await waitFor(actor, (s) => s.matches('failure'))
		expect(actor.getSnapshot().context.lastResult).toMatchObject({
			outcome: 'failed',
			settlement: 'unknown'
		})
		actor.stop()
	})
})
