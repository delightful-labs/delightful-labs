import { afterEach, expect, it, vi } from 'vitest'
import { createActor, createStepLogic, toPromise, waitFor } from 'xstate'
import type { WorkspaceInitializationReport } from 'delightful-local-first/workspace/startup-contracts'
import type { RootAccess } from '../../contracts/account.js'
import { rootStartupMachine, type RootInitializationResult } from './root-bootstrap.js'

type Report = WorkspaceInitializationReport<RootInitializationResult>
const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function fixture(db: RootAccess) {
	const binding = {}
	const recipient = createActor(
		createStepLogic({
			context: (): Report[] => [],
			run: ({ context, event }: { context: Report[]; event: Report }) => ({
				context: event.type === 'WORKSPACE_INITIALIZATION_RESULT' ? [...context, event] : context
			})
		})
	).start()
	const actor = createActor(rootStartupMachine, {
		input: { binding, recipient, initialization: { db, userId: 'owner' } }
	}).start()
	actors.add(actor)
	actors.add(recipient)
	return { actor, recipient, binding }
}

it.each(['compatible', 'incompatible'] satisfies Awaited<ReturnType<RootAccess['read']>>[])(
	'reports %s native root evidence once and waits for explicit closure',
	async (status) => {
		const ensure = vi.fn()
		const f = fixture({ read: async () => status, ensure })
		await waitFor(f.recipient, (snapshot) => snapshot.context.length === 1)
		const report = f.recipient.getSnapshot().context[0]
		expect(report?.binding).toBe(f.binding)
		expect(report?.initialization).toEqual(
			status === 'compatible'
				? { outcome: 'ready', identityId: 'owner', workspaceId: 'owner' }
				: { outcome: 'unavailable', reason: 'canonicalRootConflict' }
		)
		expect(report?.provenance).toEqual(
			status === 'compatible' ? { identityId: 'owner', initialWorkspaceId: 'owner' } : undefined
		)
		expect(ensure).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().status).toBe('active')
		f.actor.send({ type: 'SHUTDOWN' })
		expect(await toPromise(f.actor)).toEqual({
			outcome: 'closed',
			initialization: report?.initialization,
			provenance: report?.provenance
		})
		expect(f.recipient.getSnapshot().context).toHaveLength(1)
	}
)

it('retains the created root receipt in both report and terminal output', async () => {
	const write = { local: vi.fn(async () => {}), global: vi.fn(async () => {}) }
	const ensure = vi.fn(() => write)
	const f = fixture({ read: async () => 'missing', ensure })
	await waitFor(f.recipient, (snapshot) => snapshot.context.length === 1)
	const result = f.recipient.getSnapshot().context[0]?.initialization
	expect(result?.outcome).toBe('ready')
	if (result?.outcome !== 'ready') throw new Error('Missing ready creation result')
	expect(result.persistence).toEqual({ outcome: 'succeeded', write })
	expect(ensure).toHaveBeenCalledOnce()
	expect(write.local).toHaveBeenCalledOnce()
	expect(write.global).not.toHaveBeenCalled()
	f.actor.send({ type: 'SHUTDOWN' })
	expect((await toPromise(f.actor)).initialization).toBe(result)
})

it('suppresses readiness after shutdown while draining an issued local write', async () => {
	const pending = Promise.withResolvers<void>()
	const write = { local: vi.fn(() => pending.promise), global: vi.fn(async () => {}) }
	const f = fixture({ read: async () => 'missing', ensure: () => write })
	await vi.waitFor(() => expect(write.local).toHaveBeenCalledOnce())
	f.actor.send({ type: 'SHUTDOWN' })
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	pending.resolve()
	expect(await toPromise(f.actor)).toEqual({
		outcome: 'closed',
		initialization: {
			outcome: 'closed',
			settlement: 'locallyPersisted',
			persistence: { outcome: 'succeeded', write }
		},
		provenance: undefined
	})
	expect(f.recipient.getSnapshot().context).toEqual([])
})

it('refuses clean release after an unexpected native issue failure', async () => {
	const error = new Error('Native issue failed without a receipt')
	const f = fixture({
		read: async () => 'missing',
		ensure: () => {
			throw error
		}
	})
	await waitFor(f.recipient, (snapshot) => snapshot.context.length === 1)
	f.actor.send({ type: 'SHUTDOWN' })
	expect(await toPromise(f.actor)).toEqual({
		outcome: 'unresolved',
		initialization: { outcome: 'failed', settlement: 'unresolved', error },
		provenance: undefined
	})
})
