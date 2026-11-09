import { afterEach, describe, expect, it, vi } from 'vitest'
import { assign, createActor, fromPromise, setup, toPromise, waitFor } from 'xstate'
import wire from '../../../tests/fixtures/restore-journal-v1.json'
import { createRestoreWriteStepMachine } from '../machines/backup/restore-write-step.js'
import { createRestoreMachine } from '../machines/backup/restore.js'
import { isRestoreJournalSuccessor } from './restore-journal-successor.js'
import { parseRestoreJournalRecord, type RestoreJournalRecord } from './restore-journal.js'
import type { BrowserJournalConfiguration } from './restore-journal-browser.js'
import {
	restoreTransactionAccess,
	type RestoreTransactionWriter,
	type RestoreDestinationInput,
	type RestoreDestinationResult,
	type RestoreEvent
} from './restore.js'
import {
	issueWriteStep,
	observeWriteStep,
	type RestoreWriteInput,
	type RestoreStepPresence
} from './restore.js'

type TestWriter<T, W> = RestoreTransactionWriter<T, W> & {
	readRemote(...args: unknown[]): Promise<RestoreStepPresence>
	checkAuthority(...args: unknown[]): Promise<boolean>
	readTransaction(...args: unknown[]): Promise<RestoreStepPresence>
	stage(...args: unknown[]): void | Promise<void>
}
function testDestination<T, W>(writer: TestWriter<T, W>) {
	type Input = RestoreDestinationInput<T>
	type Context = { input: Input; result: RestoreDestinationResult }
	const actors = {
		remote: fromPromise(({ input }: { input: Input }) =>
			writer.readRemote(input.intent, input.step)
		),
		authority: fromPromise(({ input }: { input: Input }) =>
			writer.checkAuthority(input.intent, input.step)
		),
		read: fromPromise(({ input }: { input: Input }) =>
			restoreTransactionAccess(input).call((tx) =>
				writer.readTransaction(tx, input.intent, input.step)
			)
		),
		stage: fromPromise(({ input }: { input: Input }) =>
			restoreTransactionAccess(input).call((tx) => writer.stage(tx, input.intent, input.step))
		)
	}
	const input = ({ context }: { context: Context }) => context.input
	return setup<
		Context,
		RestoreEvent,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		RestoreDestinationResult
	>({ actors }).createMachine({
		initial: 'selecting',
		context: ({ input }) => ({ input, result: 'unavailable' }),
		output: ({ context }) => context.result,
		states: {
			selecting: {
				always: [
					{ guard: ({ context }) => context.input.operation === 'remote', target: 'remote' },
					{ guard: ({ context }) => context.input.operation === 'authority', target: 'authority' },
					{ guard: ({ context }) => context.input.operation === 'read', target: 'read' },
					{ target: 'stage' }
				]
			},
			remote: {
				invoke: {
					src: 'remote',
					input,
					onDone: { target: 'complete', actions: assign({ result: ({ event }) => event.output }) },
					onError: 'complete'
				}
			},
			authority: {
				invoke: {
					src: 'authority',
					input,
					onDone: [{ guard: ({ event }) => event.output, target: 'allowed' }, { target: 'denied' }],
					onError: 'complete'
				}
			},
			read: {
				invoke: {
					src: 'read',
					input,
					onDone: { target: 'complete', actions: assign({ result: ({ event }) => event.output }) },
					onError: 'complete'
				}
			},
			stage: { invoke: { src: 'stage', input, onDone: 'staged', onError: 'complete' } },
			allowed: { type: 'final', entry: assign({ result: 'allowed' }) },
			denied: { type: 'final', entry: assign({ result: 'denied' }) },
			staged: { type: 'final', entry: assign({ result: 'staged' }) },
			complete: { type: 'final' }
		}
	})
}

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
function fixture(record = parseRestoreJournalRecord(wire), step = record.intent.plan.preparation) {
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
				current: {
					status: 'issued',
					issuance:
						(record.checkpoint.kind === 'writing' || record.checkpoint.kind === 'activating') &&
						record.checkpoint.current.status === 'issued'
							? record.checkpoint.current.issuance + 1
							: 1
				}
			})
		}),
		commit: vi.fn(() => ({ id: 'write' })),
		transactionId: vi.fn(() => Promise.resolve('transaction-one')),
		persistLocal: vi.fn(() => Promise.resolve()),
		acceptRemote: vi.fn(() => Promise.resolve()),
		isRemoteRejection: vi.fn((error: unknown, _id: string) => error === 'confirmed-rejection'),
		rollback: vi.fn(() => Promise.resolve(true)),
		retainDetached: vi.fn(
			(_receipt: Parameters<TestWriter<{ id: string }, { id: string }>['retainDetached']>[0]) => {}
		)
	} satisfies TestWriter<{ id: string }, { id: string }>
	const input = {
		binding,
		intent: record.intent,
		record,
		step,
		writeId: step.writeId,
		databaseName: 'unit-journal'
	}
	const actor = createActor(createRestoreWriteStepMachine(writer, testDestination(writer)), {
		input
	})
	return { actor, writer, input }
}
afterEach(() => vi.unstubAllGlobals())

describe('restore preparation attempt ownership', () => {
	it('commits intent before effects, separately checkpoints local/global facts, and advances only preparation', async () => {
		const { actor, writer } = fixture()
		actor.start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('written')
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
			const initial = parseRestoreJournalRecord(wire)
			const { actor, writer } = fixture(issueWriteStep(initial, initial.intent.plan.preparation))
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
		const initial = parseRestoreJournalRecord(wire)
		const record = observeWriteStep(
			issueWriteStep(initial, initial.intent.plan.preparation),
			initial.intent.plan.preparation,
			'original',
			{ local: 'persisted', remote: 'unobserved' }
		)
		const { actor, writer } = fixture(record)
		writer.readRemote.mockResolvedValue('match')
		actor.start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('written')
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
			createRestoreWriteStepMachine(
				{ ...writer, open: () => opening.promise },
				testDestination(writer)
			),
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
			createRestoreWriteStepMachine(
				writer,
				testDestination({ ...writer, stage: () => stage.promise })
			),
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
		expect((await toPromise(actor)).outcome).toBe('written')
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
			createRestoreWriteStepMachine(
				{ ...writer, open: () => open.promise },
				testDestination(writer)
			),
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
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
			input
		}).start()
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
	expect((await toPromise(recovery.actor)).outcome).toBe('written')
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
	const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
		input
	}).start()
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
	const input = { ...base.input, step }
	const actor = createActor(
		createRestoreWriteStepMachine(base.writer, testDestination(base.writer)),
		{
			input
		}
	)
	return { ...base, actor, input }
}
describe('single batch ownership and retained journal prefix', () => {
	for (const prefix of [1, 2]) {
		it(`retains ${prefix} completed receipts and advances exactly one current batch`, async () => {
			const { actor, writer, input } = batchFixture(batchRecord(prefix))
			actor.start()
			const result = await toPromise(actor)
			expect(result.outcome).toBe('written')
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
			issueWriteStep(base.input.record, base.input.step),
			base.input.step,
			'original-batch-tx',
			{ local: 'persisted', remote: 'unobserved' }
		)
		const { actor, writer } = batchFixture(issued)
		writer.readRemote.mockResolvedValue('match')
		actor.start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('written')
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
			const { actor, writer, input } = batchFixture(
				issueWriteStep(base.input.record, base.input.step)
			)
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
		const { input, writer } = batchFixture()
		const actor = createActor(
			createRestoreWriteStepMachine(
				writer,
				testDestination({
					...writer,
					readRemote: () => Promise.resolve<RestoreStepPresence>('unavailable')
				})
			),
			{ input }
		).start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(writer.checkAuthority).not.toHaveBeenCalled()
		expect(writer.open).not.toHaveBeenCalled()
	})
	for (const leaf of ['remote', 'authority']) {
		it(`drains ${leaf} observation after cancellation before completing`, async () => {
			const { writer, input } = batchFixture()
			const gate = deferred<void>()
			const actor = createActor(
				createRestoreWriteStepMachine(
					writer,
					testDestination({
						...writer,
						readRemote: () =>
							leaf === 'remote' ? gate.promise.then(() => 'missingOrHidden') : writer.readRemote(),
						checkAuthority: () =>
							leaf === 'authority' ? gate.promise.then(() => true) : writer.checkAuthority()
					})
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
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
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
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
			input
		}).start()
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
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
			input
		}).start()
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
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
			input
		}).start()
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
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
			input
		}).start()
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
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
			input
		}).start()
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
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
			input
		}).start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(writer.readRemote).not.toHaveBeenCalled()
	})
	it('retains completed evidence but reports incomplete when native release fails', async () => {
		const { input, writer } = fixture(),
			native = nativeLockFixture()
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
			input
		}).start()
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
			createRestoreMachine(
				writer,
				testDestination({
					...writer,
					stage: () => {
						staged.resolve()
						return stage.promise
					}
				})
			),
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
	it('refuses a batch when its journal is missing without creating intent or effects', async () => {
		const { input, writer } = batchFixture(),
			native = nativeLockFixture()
		journal.record = undefined
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
			input: { ...input, writeId: 'batch-one' }
		}).start()
		const { hold } = await native.offer()
		await waitFor(actor, (s) => s.matches({ owned: 'releasing' }))
		await hold
		native.finish()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('unavailable')
		expect(result.record).toBeUndefined()
		expect(journal.commands.map((command) => command.mode)).toEqual(['load'])
		expect(writer.readRemote).not.toHaveBeenCalled()
		expect(writer.open).not.toHaveBeenCalled()
	})
	it('rejects an unknown selected write before acquiring ownership or reading the journal', async () => {
		const { input, writer } = fixture(),
			native = nativeLockFixture()
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
			input: { ...input, writeId: 'unknown-write' }
		}).start()
		expect((await toPromise(actor)).outcome).toBe('unavailable')
		expect(native.request).not.toHaveBeenCalled()
		expect(journal.commands).toEqual([])
		expect(writer.open).not.toHaveBeenCalled()
	})

	it('waits for native release after one batch, preserving the earlier prefix', async () => {
		const { input, writer } = batchFixture(),
			native = nativeLockFixture()
		const actor = createActor(createRestoreMachine(writer, testDestination(writer)), {
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
			createRestoreMachine(
				{
					...writer,
					rollback: () => {
						rollingBack.resolve()
						return rollback.promise
					}
				},
				testDestination(writer)
			),
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

function activationRecord() {
	const record = parseRestoreJournalRecord(wire)
	const completed = [record.intent.plan.preparation, ...record.intent.plan.batches].map((step) => ({
		writeId: step.writeId,
		issuance: 1,
		transactionId: step.writeId + '-transaction',
		settlement: { local: 'persisted', remote: 'accepted' }
	}))
	return parseRestoreJournalRecord({
		...record,
		revision: 10,
		checkpoint: {
			kind: 'activating',
			completed,
			comparison: {
				payloadSha256: record.intent.archive.payloadSha256,
				graphSha256: record.intent.plan.expectedGraphSha256
			},
			current: { status: 'notIssued', writeId: record.intent.plan.activation.writeId, issuance: 0 }
		}
	})
}

describe('explicit retry of a confirmed remote rejection', () => {
	const preparation = () => parseRestoreJournalRecord(wire)
	const batch = () => batchRecord()
	const activation = () => activationRecord()
	function rejected(
		record = preparation(),
		remote: 'rejected' | 'unobserved' | 'accepted' = 'rejected'
	) {
		const step =
			record.checkpoint.kind === 'activating'
				? { ...record.intent.plan.activation, mappingIndexes: [] }
				: (record.intent.plan.batches.find(
						(step) =>
							record.checkpoint.kind === 'writing' &&
							step.writeId === record.checkpoint.current.writeId
					) ?? record.intent.plan.preparation)
		return {
			step,
			record: observeWriteStep(issueWriteStep(record, step), step, 'rejected-transaction', {
				local: 'persisted',
				remote
			})
		}
	}
	for (const initial of [preparation, batch, activation]) {
		it(`retries ${initial.name} with the same intent and retains its rejected attempt`, async () => {
			const { record, step } = rejected(initial())
			const { actor, writer } = fixture(record, step)
			writer.transactionId.mockResolvedValue('replacement-transaction')
			writer.open.mockImplementation(() => {
				expect(writer.checkAuthority).toHaveBeenCalledOnce()
				expect(journal.record?.checkpoint).toMatchObject({
					current: {
						issuance: 2,
						transactionId: null,
						settlement: { local: 'unobserved', remote: 'unobserved' },
						lastRejectedAttempt: {
							issuance: 1,
							transactionId: 'rejected-transaction',
							settlement: { local: 'persisted', remote: 'rejected' }
						}
					}
				})
				return { id: 'transaction' }
			})
			actor.start()
			const result = await toPromise(actor)
			expect(result.outcome).toBe('written')
			expect(result.record?.intent).toEqual(record.intent)
			const checkpoint = result.record?.checkpoint
			const receipt =
				checkpoint?.kind === 'complete'
					? checkpoint.activation
					: completed(result.record).find((receipt) => receipt.writeId === step.writeId)
			expect(receipt).toMatchObject({
				issuance: 2,
				transactionId: 'replacement-transaction',
				lastRejectedAttempt: {
					issuance: 1,
					transactionId: 'rejected-transaction',
					settlement: { local: 'persisted', remote: 'rejected' }
				}
			})
			expect(completed(result.record).slice(0, completed(record).length)).toEqual(completed(record))
			expect(writer.commit).toHaveBeenCalledOnce()
			expect(writer.retainDetached).not.toHaveBeenCalled()
		})
	}
	for (const authority of ['denied', 'unavailable']) {
		it(`preserves the rejected checkpoint when current authority is ${authority}`, async () => {
			const { record, step } = rejected()
			const { actor, writer } = fixture(record, step)
			if (authority === 'denied') writer.checkAuthority.mockResolvedValue(false)
			else writer.checkAuthority.mockRejectedValue(new Error('Authority unavailable'))
			actor.start()
			expect((await toPromise(actor)).record).toEqual(record)
			expect(journal.commands).toEqual([])
			expect(writer.open).not.toHaveBeenCalled()
		})
	}
	for (const remote of ['unobserved', 'accepted'] satisfies ('unobserved' | 'accepted')[]) {
		it(`does not replay a ${remote} transaction even with a known ID and affirmative authority`, async () => {
			const { record, step } = rejected(preparation(), remote)
			const { actor, writer } = fixture(record, step)
			actor.start()
			expect((await toPromise(actor)).outcome).toBe('incomplete')
			expect(writer.checkAuthority).not.toHaveBeenCalled()
			expect(writer.open).not.toHaveBeenCalled()
			expect(journal.record).toEqual(record)
		})
	}
	for (const observation of ['match', 'conflict'] satisfies RestoreStepPresence[]) {
		it(`handles ${observation} before admitting another rejected-write attempt`, async () => {
			const { record, step } = rejected()
			const { actor, writer } = fixture(record, step)
			writer.readRemote.mockResolvedValue(observation)
			actor.start()
			const result = await toPromise(actor)
			expect(result.outcome).toBe(observation === 'match' ? 'written' : 'conflict')
			if (observation === 'match')
				expect(completed(result.record)[0]).toMatchObject({
					basis: 'remoteContentMatch',
					attempt: { issuance: 1, settlement: { remote: 'rejected' } }
				})
			expect(writer.checkAuthority).not.toHaveBeenCalled()
			expect(writer.open).not.toHaveBeenCalled()
		})
	}
	it('does not retry rejection without a known transaction ID', async () => {
		const initial = rejected()
		if (initial.record.checkpoint.kind !== 'writing') throw new Error('Expected writing')
		const record = parseRestoreJournalRecord({
			...initial.record,
			checkpoint: {
				...initial.record.checkpoint,
				current: { ...initial.record.checkpoint.current, transactionId: null }
			}
		})
		const { actor, writer } = fixture(record, initial.step)
		actor.start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(writer.checkAuthority).not.toHaveBeenCalled()
		expect(writer.open).not.toHaveBeenCalled()
	})
	it('does not open a transaction when saving the retry intent fails', async () => {
		const { record, step } = rejected()
		const { actor, writer } = fixture(record, step)
		journal.failRevision = record.revision + 1
		actor.start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(journal.record).toEqual(record)
		expect(writer.open).not.toHaveBeenCalled()
	})
	it('does not issue a retry after a concurrent journal update wins the CAS', async () => {
		const { record, step } = rejected()
		const { actor, writer } = fixture(record, step)
		writer.checkAuthority.mockImplementation(() => {
			journal.record = parseRestoreJournalRecord({ ...record, revision: record.revision + 1 })
			return Promise.resolve(true)
		})
		actor.start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(journal.record?.checkpoint).toEqual(record.checkpoint)
		expect(writer.open).not.toHaveBeenCalled()
	})
	for (const type of ['CANCEL', 'SHUTDOWN', 'INVALIDATE'] satisfies RestoreEvent['type'][]) {
		it(`drains authority and preserves the rejected checkpoint on ${type}`, async () => {
			const { record, step } = rejected()
			const { input, writer } = fixture(record, step)
			const gate = deferred<boolean>()
			writer.checkAuthority.mockReturnValue(gate.promise)
			const actor = createActor(createRestoreWriteStepMachine(writer, testDestination(writer)), {
				input
			}).start()
			await waitFor(actor, (snapshot) => snapshot.matches({ working: 'checkingAuthority' }))
			actor.send(type === 'INVALIDATE' ? { type, binding: input.binding } : { type })
			gate.resolve(true)
			expect((await toPromise(actor)).outcome).toBe(
				type === 'CANCEL' ? 'cancelled' : type === 'SHUTDOWN' ? 'closed' : 'invalidated'
			)
			expect(journal.record).toEqual(record)
			expect(writer.open).not.toHaveBeenCalled()
		})
	}
	it('requires another explicit invocation after repeated rejection and keeps only the latest evidence', async () => {
		const { record, step } = rejected()
		const first = fixture(record, step)
		first.writer.transactionId.mockResolvedValue('second-rejected-transaction')
		first.writer.acceptRemote.mockRejectedValue('confirmed-rejection')
		first.actor.start()
		const result = await toPromise(first.actor)
		expect(result.outcome).toBe('incomplete')
		expect(first.writer.commit).toHaveBeenCalledOnce()
		if (!result.record) throw new Error('Missing rejected checkpoint')
		const next = fixture(result.record, step)
		next.actor.start()
		const output = await toPromise(next.actor)
		expect(output.outcome).toBe('written')
		expect(completed(output.record)[0]).toMatchObject({
			issuance: 3,
			lastRejectedAttempt: {
				issuance: 2,
				transactionId: 'second-rejected-transaction',
				settlement: { remote: 'rejected' }
			}
		})
		expect(next.writer.commit).toHaveBeenCalledOnce()
	})
})

describe('restore activation ownership', () => {
	it('settles activation without adding it to the domain write prefix', async () => {
		const record = activationRecord(),
			step = { ...record.intent.plan.activation, mappingIndexes: [] }
		const { actor, writer } = fixture(record, step)
		actor.start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('written')
		expect(result.record?.checkpoint).toMatchObject({
			kind: 'complete',
			completed: record.checkpoint.kind === 'activating' ? record.checkpoint.completed : [],
			activation: { writeId: 'activate', settlement: { local: 'persisted', remote: 'accepted' } }
		})
		expect(writer.commit).toHaveBeenCalledOnce()
		expect(writer.retainDetached).not.toHaveBeenCalled()
	})
	for (const local of ['persisted', 'unobserved']) {
		it(`reconciles uncertain activation only with retained required local evidence (${local})`, async () => {
			const initial = activationRecord()
			if (initial.checkpoint.kind !== 'activating') throw new Error('Invalid test record')
			const record = parseRestoreJournalRecord({
				...initial,
				revision: 12,
				checkpoint: {
					...initial.checkpoint,
					current: {
						status: 'issued',
						writeId: 'activate',
						issuance: 1,
						transactionId: 'activation-transaction',
						settlement: { local, remote: 'unobserved' }
					}
				}
			})
			const { actor, writer } = fixture(record, {
				...record.intent.plan.activation,
				mappingIndexes: []
			})
			writer.readRemote.mockResolvedValue('match')
			actor.start()
			const result = await toPromise(actor)
			expect(result.outcome).toBe(local === 'persisted' ? 'written' : 'incomplete')
			expect(result.record?.checkpoint.kind).toBe(local === 'persisted' ? 'complete' : 'activating')
			if (result.record?.checkpoint.kind === 'complete')
				expect(result.record.checkpoint.activation).toMatchObject({
					basis: 'remoteContentMatch',
					localPersistence: 'persisted'
				})
			expect(writer.open).not.toHaveBeenCalled()
			expect(writer.commit).not.toHaveBeenCalled()
		})
	}
	it('never replays an issued activation merely because the active destination was not observed', async () => {
		const initial = activationRecord()
		if (initial.checkpoint.kind !== 'activating') throw new Error('Invalid test record')
		const record = issueWriteStep(initial, {
			...initial.intent.plan.activation,
			mappingIndexes: []
		})
		const { actor, writer } = fixture(record, {
			...record.intent.plan.activation,
			mappingIndexes: []
		})
		actor.start()
		expect((await toPromise(actor)).outcome).toBe('incomplete')
		expect(writer.open).not.toHaveBeenCalled()
		expect(journal.record).toEqual(record)
	})
	it('does not report completion when the final activation checkpoint cannot be persisted', async () => {
		const record = activationRecord()
		const { actor, writer } = fixture(record, {
			...record.intent.plan.activation,
			mappingIndexes: []
		})
		journal.failRevision = record.revision + 4
		actor.start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('incomplete')
		expect(result.record?.checkpoint.kind).toBe('activating')
		expect(writer.commit).toHaveBeenCalledOnce()
	})
})
