import { types, createActor, setup, toPromise, createAsyncLogic } from 'xstate'
import { expect, it, vi } from 'vitest'
import * as fc from 'fast-check'
import { propertyTest, assertTestCoverage, type TestSut } from '@xstate/test'
import type { EventFrom, SnapshotFrom } from 'xstate'

import { createDomainTransaction } from './domain-transaction.js'
import type { TransactionDomainInput } from '../../contracts/domain-transaction.js'
type SyncReceipt = { global: () => Promise<void> }

type Phase = 'open' | 'read' | 'stage' | 'commit' | 'persist'
function fixture(
	options: { pause?: Phase; fail?: Phase; blocked?: boolean; rollbackFails?: boolean } = {}
) {
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>()
	const trace: string[] = []
	async function step(phase: Phase) {
		trace.push(phase)
		if (phase === options.pause) {
			entered.resolve()
			await release.promise
		}
		if (phase === options.fail) throw new Error('storage unavailable')
	}
	const resource = { token: 'one transaction' },
		write = {}
	const receipt: SyncReceipt = { global: vi.fn(async () => {}) }
	type Draft = { id: string }
	type Input = TransactionDomainInput<Draft, object>
	const actors = {
		read: createAsyncLogic({
			run: async () => {
				await step('read')
			}
		}),
		stage: createAsyncLogic({
			run: async () => {
				await step('stage')
			}
		})
	}
	const domain = setup({
		schemas: {
			context: types<Input>(),
			events: { STAGE: types(), STAGED: types() },
			input: types<Input>(),
			output: types<SyncReceipt>(),
			tags: types<string>(),
			children: {
				read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
				stage: types<import('xstate').ActorRefFrom<(typeof actors)['stage']>>()
			}
		},
		actors,
		guards: { allowed: () => !options.blocked },
		actions: {}
	}).createMachine({
		context: ({ input }) => input,
		initial: 'reading',
		output: () => receipt,
		states: {
			reading: { invoke: { id: 'read', src: 'read', onDone: { target: 'checking' } } },
			checking: {
				type: 'choice',
				choice: (args) => {
					if (args.guards.allowed()) {
						return { target: 'ready' }
					}
					return { target: 'blocked' }
				}
			},
			ready: {
				entry: (args, enq) => {
					enq.sendTo(args.context.owner, {
						type: 'PREPARED',
						assessment: { outcome: 'eligible' }
					})
				},
				on: { STAGE: { target: 'staging' } }
			},
			staging: { invoke: { id: 'stage', src: 'stage', onDone: { target: 'done' } } },
			blocked: {
				entry: (args, enq) => {
					enq.sendTo(args.context.owner, {
						type: 'PREPARED',
						assessment: { outcome: 'blocked', reason: 'unavailable' }
					})
				}
			},
			done: { type: 'final' }
		}
	})
	const retainDetached = vi.fn()
	const rollback = vi.fn(async () => {
		trace.push('rollback')
		return !options.rollbackFails
	})
	const logic = createDomainTransaction<Draft, object, object, SyncReceipt>(
		(spawn, input) => spawn(domain, { input }),
		{
			retainDetached,
			open: async () => {
				await step('open')
				return resource
			},
			commit: async (current) => {
				expect(current).toBe(resource)
				await step('commit')
				return write
			},
			persistLocal: async (current) => {
				expect(current).toBe(write)
				await step('persist')
			},
			rollback
		}
	)
	const attempt = {
		operationId: 'operation',
		workspaceId: 'workspace',
		membershipId: 'membership',
		draft: { id: 'operation' }
	}
	const actor = createActor(logic, { input: { attempt } })
	const result = toPromise(actor)
	actor.start()
	return {
		actor,
		result,
		attempt,
		trace,
		receipt,
		resource,
		entered,
		release,
		rollback,
		retainDetached
	}
}
it('keeps one DLF transaction and returns the original intent without accepting remote sync', async () => {
	const f = fixture()
	const result = await f.result
	expect(result.attempt).toBe(f.attempt)
	expect(result.settlement).toEqual({ kind: 'locallyPersisted', workspace: f.receipt })
	expect(f.trace).toEqual(['open', 'read', 'stage', 'commit', 'persist'])
	expect(f.resource).toEqual({ token: 'one transaction' })
	expect(f.receipt.global).not.toHaveBeenCalled()
})
it('rolls back a domain refusal without issuing a mutation or commit', async () => {
	const f = fixture({ blocked: true })
	expect((await f.result).outcome).toBe('blocked')
	expect(f.trace).toEqual(['open', 'read', 'rollback'])
})
for (const phase of ['read', 'stage'] as const) {
	it(`returns a ${phase} failure to DLF for rollback`, async () => {
		const f = fixture({ fail: phase })
		expect((await f.result).settlement.kind).toBe('notStarted')
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.trace).not.toContain('commit')
	})
}
for (const [phase, event] of [
	['open', 'CANCEL'],
	['read', 'CANCEL'],
	['stage', 'SHUTDOWN']
] as const) {
	it(`drains ${phase} before ${event} rolls back`, async () => {
		const f = fixture({ pause: phase })
		await f.entered.promise
		f.actor.send({ type: event })
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.rollback).not.toHaveBeenCalled()
		f.release.resolve()
		const result = await f.result
		expect(result.outcome).toBe(event === 'CANCEL' ? 'cancelled' : 'closed')
		expect(result.settlement.kind).toBe('notStarted')
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.trace).not.toContain('commit')
	})
}
it('drains an already issued commit and preserves its local receipt after cancellation', async () => {
	const f = fixture({ pause: 'commit' })
	await f.entered.promise
	f.actor.send({ type: 'CANCEL' })
	f.release.resolve()
	const result = await f.result
	expect(result.outcome).toBe('cancelled')
	expect(result.settlement.kind).toBe('locallyPersisted')
	expect(f.trace).toEqual(['open', 'read', 'stage', 'commit', 'persist'])
	expect(f.rollback).not.toHaveBeenCalled()
})
for (const phase of ['commit', 'persist'] as const) {
	it(`preserves an unknown ${phase} outcome without replay`, async () => {
		const f = fixture({ fail: phase })
		expect((await f.result).settlement.kind).toBe('unresolved')
		expect(f.trace.filter((item) => item === 'stage')).toHaveLength(1)
		expect(f.rollback).toHaveBeenCalledOnce()
	})
}
it('retains an unresolved outcome when rollback is not confirmed', async () => {
	const f = fixture({ blocked: true, rollbackFails: true })
	expect((await f.result).settlement.kind).toBe('unresolved')
})

it('hands issued native work to detached custody when the public owner is force-stopped', async () => {
	const f = fixture({ pause: 'commit' })
	await f.entered.promise
	f.actor.stop()
	expect(f.retainDetached).toHaveBeenCalledOnce()
	const custody = f.retainDetached.mock.calls[0]![0]
	expect(custody.acquisition).toBeInstanceOf(Promise)
	expect(custody.commit).toBeInstanceOf(Promise)
	expect(f.rollback).not.toHaveBeenCalled()
	f.release.resolve()
	await custody.commit
	expect(f.trace.filter((value) => value === 'commit')).toHaveLength(1)
})

it('keeps local persistence owned through shutdown after commit', async () => {
	const f = fixture({ pause: 'persist' })
	await f.entered.promise
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.rollback).not.toHaveBeenCalled()
	f.release.resolve()
	const result = await f.result
	expect(result.outcome).toBe('closed')
	expect(result.settlement).toEqual({ kind: 'locallyPersisted', workspace: f.receipt })
	expect(result.attempt).toBe(f.attempt)
	expect(f.retainDetached).not.toHaveBeenCalled()
})

// Independent contract: interruption before commit prevents commit; interruption
// after commit retains local settlement. This does not reproduce the bridge graph.
const lifecycleContract = setup({
	schemas: {
		context: types<{ outcome: string; settlement: string }>(),
		events: { RUN: types<{ phase: Phase; command: 'CANCEL' | 'SHUTDOWN' }>() }
	}
}).createMachine({
	initial: 'ready',
	context: { outcome: '', settlement: '' },
	states: {
		ready: {
			on: {
				RUN: ({ event }) => ({
					target: 'settled',
					context: {
						outcome: event.command === 'CANCEL' ? 'cancelled' : 'closed',
						settlement:
							event.phase === 'commit' || event.phase === 'persist'
								? 'locallyPersisted'
								: 'notStarted'
					}
				})
			}
		},
		settled: { type: 'final' }
	}
})
const lifecycleSut: TestSut<
	SnapshotFrom<typeof lifecycleContract>,
	EventFrom<typeof lifecycleContract>
> = {
	create() {
		let observed = { outcome: '', settlement: '' }
		let running: ReturnType<typeof fixture> | undefined
		return {
			async send(event) {
				running = fixture({ pause: event.phase })
				await running.entered.promise
				running.actor.send({ type: event.command })
				expect(running.actor.getSnapshot().status).toBe('active')
				expect(running.rollback).not.toHaveBeenCalled()
				running.release.resolve()
				const result = await running.result
				expect(result.attempt).toBe(running.attempt)
				expect(running.receipt.global).not.toHaveBeenCalled()
				expect(running.trace.filter((value) => value === 'open')).toHaveLength(1)
				expect(running.trace.filter((value) => value === 'stage').length).toBeLessThanOrEqual(1)
				expect(running.trace.filter((value) => value === 'commit').length).toBeLessThanOrEqual(1)
				expect(running.retainDetached).not.toHaveBeenCalled()
				observed = { outcome: result.outcome, settlement: result.settlement.kind }
			},
			read: () => observed,
			dispose: () => {
				running?.actor.stop()
			}
		}
	},
	projectModel: (snapshot) => snapshot.context
}
it('matches generated interruption contracts through the real composed transaction owner', async () => {
	const { coverage } = await propertyTest(lifecycleContract, {
		events: {
			RUN: fc.record({
				phase: fc.constantFrom<Phase>('open', 'read', 'stage', 'commit', 'persist'),
				command: fc.constantFrom('CANCEL', 'SHUTDOWN')
			})
		},
		sut: lifecycleSut,
		seed: 20261110,
		numRuns: 150,
		maxCommands: 2,
		failures: { key: 'domain-transaction-interruption' }
	})
	assertTestCoverage(coverage, { eventTypes: 1, stateNodes: 1 })
})
