import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
	WorkspaceLease,
	WorkspaceDrainRequest
} from 'delightful-local-first/workspace/contracts'
import type { WorkspaceResourceRelease } from '../../contracts/workspace-resource-release.js'
import type { SelectedResourceReport } from '../../contracts/workspace-selected-resources.js'
import type {
	IntegrityRecipient,
	IntegrityRequest,
	IntegrityReport
} from '../../contracts/workspace-integrity-contract.js'
import type { BankSource, BankSyncDependencies } from '../bank-sync/types.js'
import { dependencies } from '../bank-sync/test-fixtures.js'
import { createWorkspaceSelectedResources } from './workspace-selected-resources.js'
import { createActor, createCallbackLogic, setup, types } from 'xstate'

const controls: {
	bank: ReturnType<typeof controlled> | undefined
	integrity: ReturnType<typeof controlled> | undefined
	read: BankSyncDependencies['read'] | undefined
} = vi.hoisted(() => ({ bank: undefined, integrity: undefined, read: undefined }))
vi.mock('../bank-sync/index.js', async (original) => {
	const actual = await original<typeof import('../bank-sync/index.js')>()
	return {
		...actual,
		createBankSyncMachine: (input: BankSyncDependencies) => {
			controls.read = input.read
			return controls.bank?.logic ?? actual.createBankSyncMachine(input)
		}
	}
})
vi.mock('../workspaces/workspace-integrity-owner.js', async (original) => {
	const actual = await original<typeof import('../workspaces/workspace-integrity-owner.js')>()
	return {
		...actual,
		createWorkspaceIntegrityOwner: (
			db: Parameters<typeof actual.createWorkspaceIntegrityOwner>[0]
		) => controls.integrity?.logic ?? actual.createWorkspaceIntegrityOwner(db)
	}
})
const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
	controls.bank = undefined
	controls.integrity = undefined
	controls.read = undefined
})
function controlled() {
	let send: ((event: { type: string }) => void) | undefined
	let recipient: IntegrityRecipient | undefined
	let result: WorkspaceResourceRelease = { outcome: 'released' }
	const shutdown = vi.fn()
	const commands: { type: string }[] = []
	const logic = setup({
		schemas: {
			context: types<{}>(),
			input: types<{ request: IntegrityRequest; recipient: IntegrityRecipient } | undefined>(),
			output: types<WorkspaceResourceRelease>()
		}
	}).createMachine({
		initial: 'working',
		context: ({ input, self }) => {
			send = (event) => self.send(event)
			recipient = input?.recipient
			return {}
		},
		output: () => result,
		states: {
			working: {
				on: {
					SHUTDOWN: (_, enq) => {
						enq(shutdown)
					},
					FINISH: { target: 'done' },
					CRASH: (args, enq) => {
						enq(() => {
							throw new Error('controlled resource crash')
						})
					},
					'*': (args, enq) => {
						enq(({ event }) => {
							commands.push(event)
						}, args)
					}
				}
			},
			done: { type: 'final' }
		}
	})
	return {
		logic,
		shutdown,
		commands,
		finish: (outcome: WorkspaceResourceRelease['outcome'] = 'released') => {
			result = { outcome }
			if (!send) throw new Error('Missing controlled resource')
			send({ type: 'FINISH' })
		},
		crash: () => {
			if (!send) throw new Error('Missing controlled resource')
			send({ type: 'CRASH' })
		},
		report: (report: IntegrityReport) => {
			if (!recipient) throw new Error('Missing integrity recipient')
			recipient.send({ type: 'INTEGRITY_STATUS', report })
		}
	}
}
function lease(): WorkspaceLease {
	return {
		scope: { binding: {}, attachment: {} },
		request: { workspaceId: 'workspace', attempt: 1 },
		epoch: 1
	}
}
function fixture(real = false, onReport?: (report: SelectedResourceReport) => void) {
	const bank = controlled(),
		integrity = controlled()
	controls.bank = real ? undefined : bank
	controls.integrity = real ? undefined : integrity
	const issued = lease()
	let source: BankSource = {
		organizationId: issued.request.workspaceId,
		userId: 'user',
		sessionReady: true,
		membership: null,
		accounts: [],
		connections: [],
		links: []
	}
	const reports: SelectedResourceReport[] = []
	const recipient = createActor(
		createCallbackLogic<SelectedResourceReport>(({ receive }) => {
			receive((report) => {
				reports.push(report)
				onReport?.(report)
			})
		})
	).start()
	const logic = createWorkspaceSelectedResources({
		dependencies: { ...dependencies(), read: () => source },
		lease: issued,
		userId: 'user'
	})
	const actor = createActor(logic, { input: { recipient } }).start()
	actors.add(actor)
	actors.add(recipient)
	const read = controls.read
	if (!read) throw new Error('Missing bank read boundary')
	const request: IntegrityRequest = {
		generation: 0,
		binding: {
			organizationId: issued.request.workspaceId,
			userId: 'user',
			profileId: 'profile',
			membershipId: 'member',
			role: 'owner',
			accountAccessMode: 'all'
		}
	}
	const drain: WorkspaceDrainRequest = { token: {}, lease: issued }
	return {
		actor,
		bank,
		integrity,
		issued,
		drain,
		request,
		reports,
		read,
		setSource: (next: BankSource) => {
			source = next
		},
		source: () => source
	}
}

describe('selected workspace resource lifetime', () => {
	it('composes the real bank and integrity children for an idle clean shutdown', () => {
		const f = fixture(true)
		f.actor.send({ type: 'DRAIN', drain: f.drain })
		expect(f.actor.getSnapshot().output).toEqual({
			lease: f.issued,
			drain: f.drain,
			release: { outcome: 'released' }
		})
		expect(f.reports).toEqual([])
	})
	it.each(['bank', 'integrity'] satisfies ('bank' | 'integrity')[])(
		'waits for the peer when %s completes first during drain',
		(first) => {
			const f = fixture()
			const child = f.actor.getSnapshot().children[first]
			f.actor.send({ type: 'DRAIN', drain: f.drain })
			expect(f.bank.shutdown).toHaveBeenCalledOnce()
			expect(f.integrity.shutdown).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().children[first]).toBe(child)
			f[first].finish()
			expect(f.actor.getSnapshot().output).toBeUndefined()
			f[first === 'bank' ? 'integrity' : 'bank'].finish()
			expect(f.actor.getSnapshot().output).toEqual({
				lease: f.issued,
				drain: f.drain,
				release: { outcome: 'released' }
			})
			expect(f.reports).toEqual([])
		}
	)
	it.each([
		['releasedWithFailure', 'released', 'releasedWithFailure'],
		['released', 'releasedWithFailure', 'releasedWithFailure'],
		['unresolved', 'released', 'unresolved'],
		['released', 'unresolved', 'unresolved'],
		['unresolved', 'releasedWithFailure', 'unresolved']
	] satisfies [
		WorkspaceResourceRelease['outcome'],
		WorkspaceResourceRelease['outcome'],
		WorkspaceResourceRelease['outcome']
	][])('combines bank %s and integrity %s into %s', (bank, integrity, outcome) => {
		const f = fixture()
		f.actor.send({ type: 'DRAIN', drain: f.drain })
		f.bank.finish(bank)
		f.integrity.finish(integrity)
		expect(f.actor.getSnapshot().output?.release).toEqual({ outcome })
		expect(f.actor.getSnapshot().matches(outcome)).toBe(true)
	})
	it.each(['bank', 'integrity'] satisfies ('bank' | 'integrity')[])(
		'drains the peer after an unexpected %s closure and accepts a reentrant host drain',
		(resource) => {
			const f = fixture(false, (report) => {
				if (report.type === 'SELECTED_RESOURCES_STOPPING')
					f.actor.send({ type: 'DRAIN', drain: f.drain })
			})
			f[resource].finish()
			const peer = f[resource === 'bank' ? 'integrity' : 'bank']
			expect(peer.shutdown).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().output).toBeUndefined()
			expect(f.reports).toContainEqual({
				type: 'SELECTED_RESOURCES_STOPPING',
				lease: f.issued,
				resource
			})
			peer.finish()
			expect(f.actor.getSnapshot().output).toEqual({
				lease: f.issued,
				drain: f.drain,
				release: { outcome: 'releasedWithFailure' }
			})
		}
	)
	it.each(['bank', 'integrity'] satisfies ('bank' | 'integrity')[])(
		'retains the peer when %s crashes before drain',
		(resource) => {
			const f = fixture()
			f[resource].crash()
			const peer = f[resource === 'bank' ? 'integrity' : 'bank']
			expect(peer.shutdown).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().output).toBeUndefined()
			f.actor.send({ type: 'SHUTDOWN' })
			peer.finish()
			expect(f.actor.getSnapshot().output?.release).toEqual({ outcome: 'unresolved' })
		}
	)
	it.each(['bank', 'integrity'] satisfies ('bank' | 'integrity')[])(
		'retains the accepted drain and peer when %s crashes during drain',
		(resource) => {
			const f = fixture()
			f.actor.send({ type: 'DRAIN', drain: f.drain })
			f[resource].crash()
			expect(f.actor.getSnapshot().output).toBeUndefined()
			f[resource === 'bank' ? 'integrity' : 'bank'].finish()
			expect(f.actor.getSnapshot().output).toEqual({
				lease: f.issued,
				drain: f.drain,
				release: { outcome: 'unresolved' }
			})
		}
	)
	it('fixes the first drain token and rejects competing requests without repeating shutdown', () => {
		const f = fixture()
		f.actor.send({ type: 'DRAIN', drain: f.drain })
		f.actor.send({ type: 'DRAIN', drain: { ...f.drain, lease: { ...f.issued } } })
		const competing = { token: {}, lease: f.issued }
		f.actor.send({ type: 'DRAIN', drain: competing })
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.reports).toEqual([
			{
				type: 'SELECTED_RESOURCE_DRAIN_REJECTED',
				lease: f.issued,
				drain: competing,
				reason: 'busy'
			}
		])
		expect(f.bank.shutdown).toHaveBeenCalledOnce()
		f.bank.finish()
		f.integrity.finish()
		expect(f.actor.getSnapshot().output?.drain).toEqual(f.drain)
	})
	it('accepts a first matching drain during shutdown without admitting late work', () => {
		const f = fixture()
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'BANK', lease: f.issued, event: { type: 'SYNC' } })
		f.actor.send({ type: 'INTEGRITY', lease: f.issued, request: f.request })
		f.actor.send({ type: 'DRAIN', drain: f.drain })
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.bank.commands).toEqual([])
		expect(f.integrity.commands).toEqual([])
		f.bank.finish()
		f.integrity.finish()
		expect(f.actor.getSnapshot().output).toEqual({
			lease: f.issued,
			drain: f.drain,
			release: { outcome: 'released' }
		})
	})
	it('rejects every changed lease field including an earlier visit to the same workspace', () => {
		const f = fixture()
		const foreign: WorkspaceLease[] = [
			{ ...f.issued, scope: { ...f.issued.scope, binding: {} } },
			{ ...f.issued, scope: { ...f.issued.scope, attachment: {} } },
			{ ...f.issued, request: { ...f.issued.request, workspaceId: 'other' } },
			{ ...f.issued, request: { ...f.issued.request, attempt: 2 } },
			{ ...f.issued, epoch: 2 }
		]
		for (const lease of foreign) {
			f.actor.send({ type: 'BANK', lease, event: { type: 'SYNC' } })
			f.actor.send({ type: 'INTEGRITY', lease, request: f.request })
			f.actor.send({ type: 'DRAIN', drain: { token: {}, lease } })
		}
		expect(f.bank.commands).toEqual([])
		expect(f.integrity.commands).toEqual([])
		expect(f.bank.shutdown).not.toHaveBeenCalled()
		expect(f.reports).toHaveLength(foreign.length)
		expect(
			f.reports.every(
				(report) =>
					report.type === 'SELECTED_RESOURCE_DRAIN_REJECTED' && report.reason === 'scopeMismatch'
			)
		).toBe(true)
	})
	it('forwards matching bank commands but rejects foreign access bindings', () => {
		const f = fixture()
		f.actor.send({ type: 'BANK', lease: f.issued, event: { type: 'SYNC' } })
		for (const access of [
			{ kind: 'allowed', organizationId: 'other', userId: 'user' },
			{ kind: 'allowed', organizationId: 'workspace', userId: 'other' }
		] satisfies import('../bank-sync/types.js').BankAccess[]) {
			f.actor.send({
				type: 'BANK',
				lease: f.issued,
				event: { type: 'WORKSPACE_ACCESS_CHANGED', revision: 1, access }
			})
		}
		expect(f.bank.commands).toEqual([{ type: 'SYNC' }])
	})
	it('forwards only newer matching integrity observations and their correlated reports', () => {
		const f = fixture()
		if (!f.request.binding) throw new Error('Missing binding')
		f.actor.send({ type: 'INTEGRITY', lease: f.issued, request: f.request })
		f.actor.send({ type: 'INTEGRITY', lease: f.issued, request: f.request })
		for (const generation of [-1, Number.NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])
			f.actor.send({ type: 'INTEGRITY', lease: f.issued, request: { ...f.request, generation } })
		for (const binding of [
			{ ...f.request.binding, userId: 'other' },
			{ ...f.request.binding, organizationId: 'other' }
		])
			f.actor.send({ type: 'INTEGRITY', lease: f.issued, request: { generation: 1, binding } })
		const next = { ...f.request, generation: 1 }
		f.actor.send({ type: 'INTEGRITY', lease: f.issued, request: next })
		f.integrity.report({ request: f.request, status: { kind: 'checking' } })
		f.integrity.report({ request: next, status: { kind: 'checking' } })
		expect(f.integrity.commands).toEqual([
			{ type: 'OBSERVED', request: f.request },
			{ type: 'OBSERVED', request: next }
		])
		expect(f.reports).toEqual([
			{
				type: 'SELECTED_INTEGRITY_STATUS',
				lease: f.issued,
				report: { request: next, status: { kind: 'checking' } }
			}
		])
		f.actor.send({ type: 'DRAIN', drain: f.drain })
		f.integrity.report({
			request: next,
			status: { kind: 'complete', settlement: 'locallyPersisted' }
		})
		expect(f.reports).toHaveLength(1)
	})
	it.each(['organization', 'identity'])(
		'makes a changed %s source unavailable to the original bank owner',
		(change) => {
			const f = fixture()
			expect(f.read()).toEqual(f.source())
			f.setSource({
				...f.source(),
				...(change === 'organization' ? { organizationId: 'other' } : { userId: 'other' })
			})
			expect(f.read()).toEqual({
				organizationId: null,
				userId: undefined,
				sessionReady: false,
				membership: undefined,
				accounts: [],
				connections: [],
				links: []
			})
		}
	)
})
