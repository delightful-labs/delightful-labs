import { afterEach, describe, expect, it, vi } from 'vitest'
import { assign, createActor, fromPromise, setup, toPromise, waitFor } from 'xstate'
import wire from '../../../tests/fixtures/restore-journal-v1.json'
import {
	createRestoreWriteStepMachine,
	createRestorePreparationWriteMachine
} from '../machines/backup/restore-preparation-write.js'
import { createRestorePreparationMachine } from '../machines/backup/restore-preparation.js'
import { isRestoreJournalSuccessor } from './restore-journal-successor.js'
import { parseRestoreJournalRecord, type RestoreJournalRecord } from './restore-journal.js'
import type { BrowserJournalConfiguration } from './restore-journal-browser.js'
import type { RestorePreparationWriter } from './restore-preparation.js'
import { issuePreparation, observePreparation } from './restore-preparation-record.js'
import {
	issueWriteStep,
	observeWriteStep,
	type RestoreWriteInput,
	type RestoreStepPresence
} from './restore-write-step.js'
import { createRestoreBatchMachine } from '../machines/backup/restore-batch.js'

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

function completed(record: RestoreWriteInput['record'] | undefined) {
	if (!record || record.checkpoint.kind === 'conflict')
		throw new Error('Expected progress checkpoint')
	return record.checkpoint.completed
}
function batchRecord(prefix = 1) {
	const initial = parseRestoreJournalRecord(wire)
	const receipt = (writeId: string) => ({
		writeId,
		issuance: 1,
		transactionId: 'accepted-' + writeId,
		settlement: { local: 'persisted', remote: 'accepted' }
	})
	return parseRestoreJournalRecord({
		...initial,
		revision: 10,
		intent: {
			...initial.intent,
			plan: {
				...initial.intent.plan,
				batches: [
					{ writeId: 'batch-one', expectedContentSha256: '5'.repeat(64), mappingIndexes: [1] },
					{ writeId: 'batch-two', expectedContentSha256: '7'.repeat(64), mappingIndexes: [2] }
				]
			}
		},
		checkpoint: {
			kind: 'writing',
			completed: prefix === 1 ? [receipt('prepare')] : [receipt('prepare'), receipt('batch-one')],
			current: {
				status: 'notIssued',
				writeId: prefix === 1 ? 'batch-one' : 'batch-two',
				issuance: 0
			}
		}
	})
}
function batchFixture(record = batchRecord()) {
	const base = fixture(record)
	const step = record.intent.plan.batches.find(
		(entry) =>
			record.checkpoint.kind === 'writing' && entry.writeId === record.checkpoint.current.writeId
	)
	if (!step) throw new Error('Missing test batch')
	const select = (_input: RestoreWriteInput) => step
	const actor = createActor(createRestoreWriteStepMachine(base.writer, select, 'batchWritten'), {
		input: base.input
	})
	return { ...base, actor, step }
}
describe('single batch ownership and retained journal prefix', () => {
	for (const prefix of [1, 2]) {
		it(`retains ${prefix} completed receipts and advances exactly one current batch`, async () => {
			const { actor, writer, input } = batchFixture(batchRecord(prefix))
			actor.start()
			const result = await toPromise(actor)
			expect(result.outcome).toBe('batchWritten')
			const before = input.record.checkpoint
			if (before.kind !== 'writing') throw new Error('Expected writing')
			expect(completed(result.record).slice(0, prefix)).toEqual(before.completed)
			expect(completed(result.record)).toHaveLength(prefix + 1)
			expect(result.record?.checkpoint.kind).toBe(prefix === 1 ? 'writing' : 'comparing')
			if (result.record?.checkpoint.kind === 'writing')
				expect(result.record.checkpoint.current).toEqual({
					status: 'notIssued',
					issuance: 0,
					writeId: 'batch-two'
				})
			expect(writer.commit).toHaveBeenCalledOnce()
		})
	}
	it('does not open the transaction if the batch issuance checkpoint fails', async () => {
		const { actor, writer, input } = batchFixture()
		journal.failRevision = input.record.revision + 1
		actor.start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(writer.open).not.toHaveBeenCalled()
	})
	it('reconciles remote content while retaining the prefix and unknown original transaction fate', async () => {
		const base = batchFixture()
		const issued = observeWriteStep(
			issueWriteStep(base.input.record, base.step),
			base.step,
			'original-batch-tx',
			{ local: 'persisted', remote: 'unobserved' }
		)
		const { actor, writer } = batchFixture(issued)
		writer.readRemote.mockResolvedValue('match')
		actor.start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('batchWritten')
		expect(completed(result.record)[0]).toEqual(completed(issued)[0])
		expect(completed(result.record)[1]).toMatchObject({
			basis: 'remoteContentMatch',
			attempt: {
				transactionId: 'original-batch-tx',
				issuance: 1,
				settlement: { local: 'persisted', remote: 'unobserved' }
			}
		})
		expect(writer.commit).not.toHaveBeenCalled()
	})
	for (const observation of ['match', 'missingOrHidden', 'conflict']) {
		it(`does not replay an unknown batch on ${observation} with missing local evidence`, async () => {
			const base = batchFixture()
			const { actor, writer, input } = batchFixture(issueWriteStep(base.input.record, base.step))
			if (observation === 'match' || observation === 'conflict')
				writer.readRemote.mockResolvedValue(observation)
			actor.start()
			const result = await toPromise(actor)
			expect(result.outcome).toBe(observation === 'conflict' ? 'conflict' : 'incomplete')
			expect(result.record).toEqual(input.record)
			expect(writer.open).not.toHaveBeenCalled()
		})
	}
	it('blocks unavailable destination control without interpreting it as missing attachment', async () => {
		const { input, writer, step } = batchFixture()
		const actor = createActor(
			createRestoreWriteStepMachine(
				{ ...writer, readRemote: () => Promise.resolve<RestoreStepPresence>('unavailable') },
				() => step,
				'batchWritten'
			),
			{ input }
		).start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(writer.checkAuthority).not.toHaveBeenCalled()
		expect(writer.open).not.toHaveBeenCalled()
	})
	for (const leaf of ['remote', 'authority']) {
		it(`drains ${leaf} observation after cancellation before completing`, async () => {
			const { writer, input, step } = batchFixture()
			const gate = deferred<void>()
			const actor = createActor(
				createRestoreWriteStepMachine(
					{
						...writer,
						readRemote: () =>
							leaf === 'remote' ? gate.promise.then(() => 'missingOrHidden') : writer.readRemote(),
						checkAuthority: () =>
							leaf === 'authority' ? gate.promise.then(() => true) : writer.checkAuthority()
					},
					() => step,
					'batchWritten'
				),
				{ input }
			).start()
			await waitFor(actor, (snapshot) =>
				snapshot.matches({ working: leaf === 'remote' ? 'reconciling' : 'checkingAuthority' })
			)
			actor.send({ type: 'CANCEL' })
			expect(actor.getSnapshot().status).toBe('active')
			gate.resolve()
			expect((await toPromise(actor)).outcome).toBe('cancelled')
			expect(writer.open).not.toHaveBeenCalled()
		})
	}
	it('rolls back a transaction conflict without erasing prior completed receipts', async () => {
		const { actor, writer, input } = batchFixture()
		writer.readTransaction.mockResolvedValue('conflict')
		actor.start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('conflict')
		expect(completed(result.record)).toEqual(completed(input.record))
		expect(writer.rollback).toHaveBeenCalledOnce()
		expect(writer.stage).not.toHaveBeenCalled()
	})
	it('refuses a stale requested step after loading a later completed prefix', async () => {
		const { writer, input } = batchFixture(batchRecord(2))
		vi.stubGlobal('navigator', {
			locks: {
				request: (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) =>
					callback({})
			}
		})
		const actor = createActor(createRestoreBatchMachine(writer), {
			input: { ...input, writeId: 'batch-one' }
		}).start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('incomplete')
		expect(result.record).toEqual(input.record)
		expect(writer.readRemote).not.toHaveBeenCalled()
	})
})

/** Native facts are independently gated: callback grant, hold resolution and request settlement. */
function nativeLockFixture() {
	const requested = deferred<{
		name: string
		callback: (lock: { name: string; mode: 'exclusive' } | null) => Promise<void>
	}>()
	let rejectRequest: (reason: unknown) => void = () => {
		throw new Error('Missing request')
	}
	const finished = deferred<void>()
	const settled = new Promise<void>((resolve, reject) => {
		rejectRequest = reject
		void finished.promise.then(resolve)
	})
	const request = vi.fn(
		(
			name: string,
			options: unknown,
			callback: (lock: { name: string; mode: 'exclusive' } | null) => Promise<void>
		) => {
			expect(options).toEqual({ mode: 'exclusive', ifAvailable: true })
			requested.resolve({ name, callback })
			return settled
		}
	)
	vi.stubGlobal('navigator', { locks: { request } })
	return {
		request,
		finish: () => finished.resolve(),
		fail: () => rejectRequest(new Error('Native lock request failed')),
		async offer(available = true) {
			const { name, callback } = await requested.promise
			return { hold: callback(available ? { name, mode: 'exclusive' } : null) }
		},
		requested: requested.promise
	}
}
describe('operation lock actor and coordinator release ownership', () => {
	it('does not complete preparation until native release is acknowledged', async () => {
		const { input, writer } = fixture(),
			native = nativeLockFixture()
		const actor = createActor(createRestorePreparationMachine(writer), { input }).start()
		const { hold } = await native.offer()
		await waitFor(actor, (snapshot) => snapshot.matches({ owned: 'releasing' }))
		await hold
		expect(actor.getSnapshot().status).toBe('active')
		expect(writer.commit).toHaveBeenCalledOnce()
		native.finish()
		expect((await toPromise(actor)).outcome).toBe('prepared')
	})
	it('cancels a delayed acquisition without admitting a late grant or touching the journal', async () => {
		const { input, writer } = fixture(),
			native = nativeLockFixture()
		const actor = createActor(createRestorePreparationMachine(writer), { input }).start()
		await native.requested
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().matches({ owned: 'releasing' })).toBe(true)
		const { hold } = await native.offer()
		await hold
		expect(actor.getSnapshot().status).toBe('active')
		expect(journal.commands).toEqual([])
		expect(writer.readRemote).not.toHaveBeenCalled()
		native.finish()
		expect((await toPromise(actor)).outcome).toBe('cancelled')
	})
	it('releases a late browser callback even after abrupt owner disposal', async () => {
		const { input, writer } = fixture(),
			native = nativeLockFixture()
		const actor = createActor(createRestorePreparationMachine(writer), { input }).start()
		await native.requested
		actor.stop()
		const { hold } = await native.offer()
		await hold
		native.finish()
		expect(writer.open).not.toHaveBeenCalled()
		expect(journal.commands).toEqual([])
	})
	it('waits for settlement of a refused native request without doing unlocked work', async () => {
		const { input, writer } = fixture(),
			native = nativeLockFixture()
		const actor = createActor(createRestorePreparationMachine(writer), { input }).start()
		const { hold } = await native.offer(false)
		await hold
		expect(actor.getSnapshot().status).toBe('active')
		expect(journal.commands).toEqual([])
		native.finish()
		expect((await toPromise(actor)).outcome).toBe('unavailable')
		expect(writer.open).not.toHaveBeenCalled()
	})
	it('reports native request rejection without acquiring or writing', async () => {
		const { input, writer } = fixture(),
			native = nativeLockFixture()
		const actor = createActor(createRestorePreparationMachine(writer), { input }).start()
		await native.requested
		native.fail()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(journal.commands).toEqual([])
		expect(writer.open).not.toHaveBeenCalled()
	})
	it('captures a synchronous request error through the native leaf', async () => {
		const { input, writer } = fixture()
		vi.stubGlobal('navigator', {
			locks: {
				request: () => {
					throw new Error('Native request throw')
				}
			}
		})
		const actor = createActor(createRestorePreparationMachine(writer), { input }).start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(writer.readRemote).not.toHaveBeenCalled()
	})
	it('retains completed evidence but reports incomplete when native release fails', async () => {
		const { input, writer } = fixture(),
			native = nativeLockFixture()
		const actor = createActor(createRestorePreparationMachine(writer), { input }).start()
		const { hold } = await native.offer()
		await waitFor(actor, (snapshot) => snapshot.matches({ owned: 'releasing' }))
		await hold
		native.fail()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('incomplete')
		expect(completed(result.record)).toHaveLength(1)
		expect(writer.commit).toHaveBeenCalledOnce()
	})
	it('drains an issued stage and rolls back on lock loss before completing', async () => {
		const { input, writer } = fixture(),
			native = nativeLockFixture(),
			stage = deferred<void>(),
			staged = deferred<void>()
		const held = vi.fn()
		const actor = createActor(
			createRestorePreparationMachine({
				...writer,
				stage: () => {
					staged.resolve()
					return stage.promise
				}
			}),
			{ input }
		).start()
		const { hold } = await native.offer()
		void hold.then(held)
		await staged.promise
		native.fail()
		await waitFor(actor, (snapshot) => snapshot.context.interruption === 'closed')
		expect(actor.getSnapshot().status).toBe('active')
		expect(writer.rollback).not.toHaveBeenCalled()
		expect(held).not.toHaveBeenCalled()
		stage.resolve()
		const result = await toPromise(actor)
		await hold
		expect(result.outcome).toBe('incomplete')
		expect(writer.rollback).toHaveBeenCalledOnce()
		expect(writer.commit).not.toHaveBeenCalled()
		expect(result.record?.checkpoint).toMatchObject({ current: { status: 'issued' } })
	})
	it('waits for native release after one batch, preserving the earlier prefix', async () => {
		const { input, writer } = batchFixture(),
			native = nativeLockFixture()
		const actor = createActor(createRestoreBatchMachine(writer), {
			input: { ...input, writeId: 'batch-one' }
		}).start()
		const { hold } = await native.offer()
		await waitFor(actor, (snapshot) => snapshot.matches({ owned: 'releasing' }))
		await hold
		expect(actor.getSnapshot().status).toBe('active')
		expect(writer.commit).toHaveBeenCalledOnce()
		native.finish()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('batchWritten')
		expect(completed(result.record).slice(0, 1)).toEqual(completed(input.record))
	})
	it('keeps the lock through batch rollback and then waits for native release acknowledgement', async () => {
		const { input, writer } = batchFixture(),
			native = nativeLockFixture(),
			rollback = deferred<boolean>(),
			rollingBack = deferred<void>()
		writer.readTransaction.mockResolvedValue('conflict')
		const released = vi.fn()
		const actor = createActor(
			createRestoreBatchMachine({
				...writer,
				rollback: () => {
					rollingBack.resolve()
					return rollback.promise
				}
			}),
			{ input: { ...input, writeId: 'batch-one' } }
		).start()
		const { hold } = await native.offer()
		void hold.then(released)
		await rollingBack.promise
		expect(released).not.toHaveBeenCalled()
		rollback.resolve(true)
		await waitFor(actor, (snapshot) => snapshot.matches({ owned: 'releasing' }))
		await hold
		expect(actor.getSnapshot().status).toBe('active')
		native.finish()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('conflict')
		expect(completed(result.record)).toEqual(completed(input.record))
		expect(writer.commit).not.toHaveBeenCalled()
	})
})
