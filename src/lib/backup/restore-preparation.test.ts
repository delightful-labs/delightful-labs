import { afterEach, describe, expect, it, vi } from 'vitest'
import { assign, createActor, fromPromise, setup, toPromise, waitFor } from 'xstate'
import wire from '../../../tests/fixtures/restore-journal-v1.json'
import { createRestorePreparationWriteMachine } from '../machines/backup/restore-preparation-write.js'
import { createRestorePreparationMachine } from '../machines/backup/restore-preparation.js'
import { isRestoreJournalSuccessor } from './restore-journal-successor.js'
import { parseRestoreJournalRecord, type RestoreJournalRecord } from './restore-journal.js'
import type { BrowserJournalConfiguration } from './restore-journal-browser.js'
import type { RestorePreparationWriter } from './restore-preparation.js'
import { issuePreparation, observePreparation } from './restore-preparation-record.js'

const journal = vi.hoisted(() => {
	const state: {
		record: RestoreJournalRecord | undefined
		commands: BrowserJournalConfiguration['command'][]
		failRevision: number | undefined
	} = { record: undefined, commands: [], failRevision: undefined }
	return state
})
vi.mock('../machines/backup/restore-journal-step.js', () => ({
	createRestoreJournalStepMachine: () => testJournalMachine()
}))
function testJournalMachine() {
	type Result = {
		outcome: 'loaded' | 'missing' | 'created' | 'updated' | 'existing' | 'conflict' | 'failed'
		record: RestoreJournalRecord | undefined
	}
	type Context = { configuration: BrowserJournalConfiguration; result: Result }
	const actors = {
		command: fromPromise<Result, BrowserJournalConfiguration>(({ input }) => {
			const command = input.command
			journal.commands.push(command)
			if (command.mode === 'load' || command.mode === 'discover')
				return Promise.resolve({
					outcome: journal.record ? 'loaded' : 'missing',
					record: journal.record
				})
			if (command.mode === 'initialize') throw new Error('Unexpected fixture initialization')
			if (command.mode === 'create') {
				journal.record ??= command.record
				return Promise.resolve({ outcome: 'created', record: journal.record })
			}
			if (command.record.revision === journal.failRevision)
				return Promise.resolve({ outcome: 'failed', record: undefined })
			if (
				!journal.record ||
				command.expectedRevision !== journal.record.revision ||
				!isRestoreJournalSuccessor(journal.record, command.record)
			)
				return Promise.resolve({ outcome: 'conflict', record: journal.record })
			journal.record = command.record
			return Promise.resolve({ outcome: 'updated', record: journal.record })
		})
	}
	return setup<
		Context,
		{ type: 'UNUSED' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		BrowserJournalConfiguration,
		Result
	>({ actors }).createMachine({
		context: ({ input }) => ({
			configuration: input,
			result: { outcome: 'failed', record: undefined }
		}),
		initial: 'running',
		output: ({ context }) => context.result,
		states: {
			running: {
				invoke: {
					src: 'command',
					input: ({ context }) => context.configuration,
					onDone: { target: 'complete', actions: assign({ result: ({ event }) => event.output }) },
					onError: 'complete'
				}
			},
			complete: { type: 'final' }
		}
	})
}
function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error('Missing gate')
	}
	const promise = new Promise<T>((yes) => {
		resolve = yes
	})
	return { promise, resolve }
}
function fixture(record = parseRestoreJournalRecord(wire)) {
	journal.record = record
	journal.commands = []
	journal.failRevision = undefined
	const scope = record.intent.operation
	const binding = {
		applicationId: scope.applicationId,
		environment: scope.environment,
		identityId: scope.identityId,
		workspaceId: scope.destinationWorkspaceId,
		operationId: scope.operationId,
		generation: 4
	}
	const writer = {
		readRemote: vi.fn(() =>
			Promise.resolve<'match' | 'missingOrHidden' | 'conflict'>('missingOrHidden')
		),
		checkAuthority: vi.fn(() => Promise.resolve(true)),
		open: vi.fn(() => ({ id: 'transaction' })),
		readTransaction: vi.fn(() =>
			Promise.resolve<'match' | 'missingOrHidden' | 'conflict'>('missingOrHidden')
		),
		stage: vi.fn(() => {
			expect(journal.record?.checkpoint).toMatchObject({
				current: { status: 'issued', issuance: 1 }
			})
		}),
		commit: vi.fn(() => ({ id: 'write' })),
		transactionId: vi.fn(() => Promise.resolve('transaction-one')),
		persistLocal: vi.fn(() => Promise.resolve()),
		acceptRemote: vi.fn(() => Promise.resolve()),
		isRemoteRejection: vi.fn((error: unknown, _id: string) => error === 'confirmed-rejection'),
		rollback: vi.fn(() => Promise.resolve(true)),
		retainDetached: vi.fn(
			(
				_receipt: Parameters<
					RestorePreparationWriter<{ id: string }, { id: string }>['retainDetached']
				>[0]
			) => {}
		)
	} satisfies RestorePreparationWriter<{ id: string }, { id: string }>
	const input = { binding, intent: record.intent, record, databaseName: 'unit-journal' }
	const actor = createActor(createRestorePreparationWriteMachine(writer), { input })
	return { actor, writer, input }
}
afterEach(() => vi.unstubAllGlobals())

describe('restore preparation attempt ownership', () => {
	it('commits intent before effects, separately checkpoints local/global facts, and advances only preparation', async () => {
		const { actor, writer } = fixture()
		actor.start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('prepared')
		expect(
			journal.commands
				.filter((command) => command.mode === 'update')
				.map((command) => command.record.checkpoint)
		).toMatchObject([
			{
				current: {
					status: 'issued',
					transactionId: null,
					settlement: { local: 'unobserved', remote: 'unobserved' }
				}
			},
			{
				current: {
					transactionId: 'transaction-one',
					settlement: { local: 'persisted', remote: 'unobserved' }
				}
			},
			{ current: { settlement: { local: 'persisted', remote: 'accepted' } } },
			{
				completed: [{ writeId: 'prepare', settlement: { local: 'persisted', remote: 'accepted' } }],
				current: { status: 'notIssued', writeId: 'batch-notes' }
			}
		])
		expect(writer.commit).toHaveBeenCalledOnce()
		expect(writer.retainDetached).not.toHaveBeenCalled()
	})
	it('requires journal issuance commitment before opening a destination transaction', async () => {
		const { actor, writer } = fixture()
		journal.failRevision = 1
		actor.start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(writer.open).not.toHaveBeenCalled()
	})
	it('blocks effects without current authority', async () => {
		const { actor, writer } = fixture()
		writer.checkAuthority.mockResolvedValue(false)
		actor.start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(journal.commands).toHaveLength(0)
		expect(writer.open).not.toHaveBeenCalled()
	})
	for (const observation of ['missingOrHidden', 'conflict', 'match']) {
		it(`never replays an issued outcome on ${observation} without required local evidence`, async () => {
			const { actor, writer } = fixture(issuePreparation(parseRestoreJournalRecord(wire)))
			if (observation === 'match' || observation === 'conflict')
				writer.readRemote.mockResolvedValue(observation)
			actor.start()
			expect((await toPromise(actor)).outcome).toBe(
				observation === 'conflict' ? 'conflict' : 'incomplete'
			)
			expect(writer.open).not.toHaveBeenCalled()
			expect(writer.commit).not.toHaveBeenCalled()
			expect(journal.commands).toHaveLength(0)
		})
	}
	it('reconciles a remote match retaining unknown transaction acceptance and separate local evidence', async () => {
		const record = observePreparation(
			issuePreparation(parseRestoreJournalRecord(wire)),
			'original',
			{ local: 'persisted', remote: 'unobserved' }
		)
		const { actor, writer } = fixture(record)
		writer.readRemote.mockResolvedValue('match')
		actor.start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('prepared')
		expect(result.record?.checkpoint).toMatchObject({
			completed: [
				{
					basis: 'remoteContentMatch',
					localPersistence: 'persisted',
					attempt: { transactionId: 'original', settlement: { remote: 'unobserved' } }
				}
			]
		})
		expect(writer.open).not.toHaveBeenCalled()
	})
	for (const error of ['confirmed-rejection', new Error('Generic failure')]) {
		it(`retains ${typeof error === 'string' ? 'confirmed rejection' : 'uncertainty'} without retry`, async () => {
			const { actor, writer } = fixture()
			writer.acceptRemote.mockRejectedValue(error)
			actor.start()
			expect((await toPromise(actor)).record?.checkpoint).toMatchObject({
				current: {
					issuance: 1,
					transactionId: 'transaction-one',
					settlement: {
						local: 'persisted',
						remote: typeof error === 'string' ? 'rejected' : 'unobserved'
					}
				}
			})
			expect(writer.commit).toHaveBeenCalledOnce()
			expect(writer.retainDetached).toHaveBeenCalledOnce()
		})
	}
	it('does not invent local persistence from remote acceptance after a local observation failure', async () => {
		const { actor, writer } = fixture()
		writer.persistLocal.mockRejectedValue(new Error('Unknown local wait'))
		actor.start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('incomplete')
		expect(result.record?.checkpoint).toMatchObject({
			completed: [],
			current: { settlement: { local: 'unobserved', remote: 'accepted' } }
		})
	})
	it('rolls back a late acquired transaction after cancellation without staging', async () => {
		const { input, writer } = fixture()
		const opening = deferred<{ id: string }>()
		const actor = createActor(
			createRestorePreparationWriteMachine({ ...writer, open: () => opening.promise }),
			{ input }
		).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ working: 'opening' }))
		actor.send({ type: 'CANCEL' })
		opening.resolve({ id: 'late' })
		expect((await toPromise(actor)).outcome).toBe('cancelled')
		expect(writer.rollback).toHaveBeenCalledWith({ id: 'late' })
		expect(writer.stage).not.toHaveBeenCalled()
	})
	it('stops later effects after current-generation invalidation during staging', async () => {
		const { input, writer } = fixture()
		const stage = deferred<void>()
		const actor = createActor(
			createRestorePreparationWriteMachine({ ...writer, stage: () => stage.promise }),
			{ input }
		).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ working: 'staging' }))
		actor.send({ type: 'INVALIDATE', binding: input.binding })
		stage.resolve()
		expect((await toPromise(actor)).outcome).toBe('invalidated')
		expect(writer.commit).not.toHaveBeenCalled()
		expect(writer.rollback).toHaveBeenCalledOnce()
	})
	it('rejects stale generation invalidation and retains actual settlement', async () => {
		const { actor, input } = fixture()
		actor.start()
		actor.send({
			type: 'INVALIDATE',
			binding: { ...input.binding, generation: input.binding.generation - 1 }
		})
		expect((await toPromise(actor)).outcome).toBe('prepared')
	})
	it('cancels a global observation after durably recording local persistence, without rollback', async () => {
		const { actor, writer } = fixture()
		writer.acceptRemote.mockReturnValue(new Promise(() => {}))
		actor.start()
		await waitFor(actor, (snapshot) => snapshot.matches({ working: 'observingRemote' }))
		actor.send({ type: 'CANCEL' })
		expect((await toPromise(actor)).record?.checkpoint).toMatchObject({
			current: { settlement: { local: 'persisted', remote: 'unobserved' } }
		})
		expect(writer.rollback).not.toHaveBeenCalled()
		expect(writer.retainDetached).toHaveBeenCalledOnce()
	})
	it('transfers the late acquisition receipt on abrupt stop', async () => {
		const { input, writer } = fixture()
		const open = deferred<{ id: string }>()
		const actor = createActor(
			createRestorePreparationWriteMachine({ ...writer, open: () => open.promise }),
			{ input }
		).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ working: 'opening' }))
		actor.stop()
		expect(writer.retainDetached).toHaveBeenCalledOnce()
		open.resolve({ id: 'late' })
		const receipt = writer.retainDetached.mock.calls[0]?.[0]
		expect(await receipt?.acquisition).toEqual({ id: 'late' })
		expect(writer.stage).not.toHaveBeenCalled()
	})
	it('does not open a destination transaction after a failed local checkpoint', async () => {
		const { actor, writer } = fixture()
		journal.failRevision = 2
		actor.start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(writer.acceptRemote).not.toHaveBeenCalled()
		expect(writer.commit).toHaveBeenCalledOnce()
		expect(writer.retainDetached).toHaveBeenCalledOnce()
	})
	it('blocks the coordinator when browser exclusive ownership is unavailable', async () => {
		const { input, writer } = fixture()
		vi.stubGlobal('navigator', undefined)
		const actor = createActor(createRestorePreparationMachine(writer), { input }).start()
		expect((await toPromise(actor)).outcome).toBe('unavailable')
		expect(writer.readRemote).not.toHaveBeenCalled()
	})
})

it('recovers a missed completion checkpoint from a fresh remote match without issuing a second transaction', async () => {
	const first = fixture()
	journal.failRevision = 4
	first.actor.start()
	const incomplete = await toPromise(first.actor)
	expect(incomplete.outcome).toBe('incomplete')
	if (!incomplete.record) throw new Error('Expected retained record')
	const recovery = fixture(incomplete.record)
	recovery.writer.readRemote.mockResolvedValue('match')
	recovery.actor.start()
	expect((await toPromise(recovery.actor)).outcome).toBe('prepared')
	expect(recovery.writer.commit).not.toHaveBeenCalled()
})

it('requests nonqueued exclusive ownership without the incompatible AbortSignal option', async () => {
	const { input, writer } = fixture()
	const request = vi.fn(
		(
			name: string,
			options: unknown,
			callback: (lock: { name: string; mode: 'exclusive' }) => Promise<void>
		) => {
			expect(options).toEqual({ mode: 'exclusive', ifAvailable: true })
			return callback({ name, mode: 'exclusive' })
		}
	)
	vi.stubGlobal('navigator', { locks: { request } })
	const actor = createActor(createRestorePreparationMachine(writer), { input }).start()
	expect((await toPromise(actor)).outcome).toBe('prepared')
	expect(request).toHaveBeenCalledOnce()
})
