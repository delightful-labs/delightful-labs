import { afterEach, expect, it, vi } from 'vitest'
import { createActor, createCallbackLogic, setup, types, type InputFrom } from 'xstate'
import {
	financeQueriesMachine,
	financeQueriesReleaseUnresolved,
	selectFinanceQueryFacts,
	type FinanceContentCapabilities
} from './worker-queries.js'
import { observeFinanceQuery, type FinanceContentSource } from './worker-query-observation.js'
import type { WorkerLedgerRecord } from '../../contracts/worker-application.js'

const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
const workspaceId = '20000000-0000-4000-8000-000000000001'
function fixture(fault?: { source: FinanceContentSource; stage: 'construction' | 'disposal' }) {
	const disposers = new Map<FinanceContentSource, ReturnType<typeof vi.fn<() => void>>>()
	const callbacks = new Map<FinanceContentSource, { emit(): void; failed(): void }>()
	const order: string[] = []
	const reportDisposalFailure = vi.fn()
	function observe(source: FinanceContentSource, emit: () => void, failed: () => void) {
		if (fault?.source === source && fault.stage === 'construction')
			throw new Error('Acquire failed')
		const release = vi.fn(() => {
			order.push(source)
			emit()
			failed()
			if (fault?.source === source && fault.stage === 'disposal') throw new Error('Release failed')
		})
		disposers.set(source, release)
		callbacks.set(source, { emit, failed })
		emit()
		return release
	}
	const capabilities: FinanceContentCapabilities = {
		observeBankConnections: (_id, publish, failed) =>
			observe('bankConnections', () => publish([]), failed),
		observeBankLinks: (_id, publish, failed) => observe('bankLinks', () => publish([]), failed),
		observeTransfers: (_id, publish, failed) => observe('transfers', () => publish([]), failed),
		observeWorkspaceMembers: (_id, publish, failed) =>
			observe('workspaceMembers', () => publish([]), failed),
		observeAccountGrants: (_id, publish, failed) =>
			observe('accountGrants', () => publish([]), failed),
		observeAccounts: (_id, publish, failed) => observe('accounts', () => publish([]), failed),
		observeGrants: (_id, publish, failed) => observe('grants', () => publish([]), failed),
		observeCategories: (_id, publish, failed) => observe('categories', () => publish([]), failed),
		observeTags: (_id, publish, failed) => observe('tags', () => publish([]), failed),
		observeTransaction: (_id, _transactionId, publish, failed) =>
			observe('transaction', () => publish(null), failed),
		observeTransactions: (_id, publish, failed) =>
			observe('transactions', () => publish([]), failed)
	}
	const input: InputFrom<typeof financeQueriesMachine> = {
		ready: { capabilities },
		transactionId: '30000000-0000-4000-8000-000000000001',
		selection: { workspaceId, revision: 1 },
		binding: {},
		reportDisposalFailure
	}
	return { input, disposers, callbacks, order, reportDisposalFailure }
}
function start(input: InputFrom<typeof financeQueriesMachine>) {
	const actor = createActor(financeQueriesMachine, { input }).start()
	actors.add(actor)
	return actor
}

it('consumes eleven actual native receipts before clean closure and suppresses callbacks during release', () => {
	const f = fixture(),
		actor = start(f.input)
	const outputs: string[] = []
	actor.subscribe({ complete: () => outputs.push(`${f.order.length} released`) })
	expect(selectFinanceQueryFacts(actor.getSnapshot()).status).toBe('ready')
	expect(f.disposers.size).toBe(11)
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().output).toEqual({ outcome: 'released' })
	expect(outputs).toEqual(['11 released'])
	for (const release of f.disposers.values()) expect(release).toHaveBeenCalledOnce()
	actor.stop()
	for (const release of f.disposers.values()) expect(release).toHaveBeenCalledOnce()
})

it('releases content on native read failure, then closes from the retained receipt without disposing twice', () => {
	const f = fixture(),
		actor = start(f.input)
	f.callbacks.get('accounts')?.failed()
	expect(actor.getSnapshot().matches('failed')).toBe(true)
	expect(selectFinanceQueryFacts(actor.getSnapshot()).status).toBe('failed')
	expect(f.order).toHaveLength(11)
	expect(financeQueriesReleaseUnresolved(actor.getSnapshot())).toBe(false)
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().output).toEqual({ outcome: 'released' })
	for (const release of f.disposers.values()) expect(release).toHaveBeenCalledOnce()
})

it.each(['construction', 'disposal'] satisfies readonly ('construction' | 'disposal')[])(
	'retains unresolved custody after native %s failure',
	(stage) => {
		const f = fixture({ source: 'accounts', stage }),
			actor = start(f.input)
		actor.send({ type: 'SHUTDOWN' })
		expect(financeQueriesReleaseUnresolved(actor.getSnapshot())).toBe(true)
		expect(actor.getSnapshot().status).toBe('active')
		expect(actor.getSnapshot().output).toBeUndefined()
		expect(f.reportDisposalFailure).toHaveBeenCalledTimes(stage === 'disposal' ? 1 : 0)
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().output).toBeUndefined()
		for (const release of f.disposers.values()) expect(release).toHaveBeenCalledOnce()
	}
)

it('cannot close from missing, foreign or duplicate receipts', () => {
	const f = fixture()
	type ObserverInput = InputFrom<ReturnType<typeof observeFinanceQuery<WorkerLedgerRecord[]>>>
	let acknowledge = () => {}
	const held = createCallbackLogic<{ type: 'RELEASE' }, ObserverInput>(
		({ input, receive, sendBack }) => {
			receive(() => {
				acknowledge = () =>
					sendBack({
						type: 'OBSERVATION_RELEASED',
						binding: input.binding,
						source: 'transactions',
						outcome: 'released'
					})
			})
		}
	)
	const actor = createActor(financeQueriesMachine.provide({ actors: { transactions: held } }), {
		input: f.input
	}).start()
	actors.add(actor)
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	actor.send({
		type: 'OBSERVATION_RELEASED',
		binding: f.input.binding,
		source: 'accounts',
		outcome: 'released'
	})
	actor.send({
		type: 'OBSERVATION_RELEASED',
		binding: {},
		source: 'transactions',
		outcome: 'released'
	})
	expect(actor.getSnapshot().status).toBe('active')
	acknowledge()
	expect(actor.getSnapshot().output).toEqual({ outcome: 'released' })
})

it('preserves shutdown priority when native failure and close arrive in one parent burst', () => {
	const f = fixture()
	const parent = setup({
		schemas: { context: types<{ receipt: 'released' | undefined }>() },
		actors: { queries: financeQueriesMachine }
	}).createMachine({
		initial: 'running',
		context: { receipt: undefined },
		states: {
			running: {
				entry: (_, enq) => {
					enq.sendTo('queries', { type: 'READ_FAILED', binding: f.input.binding })
					enq.sendTo('queries', { type: 'SHUTDOWN' })
				},
				invoke: {
					id: 'queries',
					src: 'queries',
					input: f.input,
					onDone: ({ event }) => ({ target: 'closed', context: { receipt: event.output.outcome } }),
					onError: { target: 'failed' }
				}
			},
			closed: { type: 'final' },
			failed: {}
		}
	})
	const actor = createActor(parent).start()
	actors.add(actor)
	expect(actor.getSnapshot().context.receipt).toBe('released')
	expect(actor.getSnapshot().status).toBe('done')
	expect(f.order).toHaveLength(11)
})
