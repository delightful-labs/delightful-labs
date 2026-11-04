import { assign, fromPromise, setup } from 'xstate'
import { sameBackupBinding } from '../../backup/export.js'
import type { RestoreJournalRecord } from '../../backup/restore-journal.js'
import {
	completeWriteStep,
	issueWriteStep,
	observeWriteStep,
	writeStepAttempt,
	writeStepCanReconcile,
	writeStepCompleted,
	writeStepNotIssued,
	writeStepSettlementSatisfied,
	reconcileWriteStep,
	type RestorePlannedWrite,
	type RestoreStepWriter,
	type RestoreWriteInput,
	type RestoreWriteResult
} from '../../backup/restore-write-step.js'
import {
	requirePreparationValue,
	type RestorePreparationEvent,
	type RestorePreparationWriter
} from '../../backup/restore-preparation.js'
import {
	clearTransactionCustody,
	createTransactionCustody,
	transactionCall,
	transactionCustodian
} from '../workspaces/transaction-custody.js'
import { createRestoreJournalStepMachine } from './restore-journal-step.js'

/** Shared one-step statechart; factories bind the planned descriptor, not alternate I/O workflows. */
export function createRestoreWriteStepMachine<
	Transaction,
	Write,
	Input extends RestoreWriteInput,
	Success extends 'prepared' | 'batchWritten'
>(
	capability: RestoreStepWriter<Transaction, Write>,
	selectWrite: (input: Input) => RestorePlannedWrite,
	completedOutcome: Success
) {
	type Native = {
		custody: ReturnType<typeof createTransactionCustody<Transaction, Write>>
		transaction: Transaction | undefined
		write: Write | undefined
		transactionId: string | undefined
	}
	type Handle = { toJSON(): { kind: 'restorePreparationNative' } }
	const storage = new WeakMap<Handle, Native>()
	const native = (handle: Handle) => requirePreparationValue(storage.get(handle))
	function allocate(): Handle {
		const handle: Handle = { toJSON: () => ({ kind: 'restorePreparationNative' }) }
		storage.set(handle, {
			custody: createTransactionCustody(capability.retainDetached),
			transaction: undefined,
			write: undefined,
			transactionId: undefined
		})
		return handle
	}
	type Context = RestoreWriteInput & {
		step: RestorePlannedWrite
		native: Handle
		candidate: RestoreJournalRecord | undefined
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		outcome: RestoreWriteResult<Success>['outcome']
	}
	const actors = {
		journal: createRestoreJournalStepMachine(),
		custodian: transactionCustodian<Transaction, Write>(),
		remote: fromPromise(({ input }: { input: Context }) =>
			capability.readRemote(input.intent, input.step)
		),
		authority: fromPromise(({ input }: { input: Context }) =>
			capability.checkAuthority(input.intent, input.step)
		),
		open: fromPromise(({ input }: { input: Handle }) => {
			const data = native(input)
			const call = transactionCall(data.custody, () => capability.open())
			data.custody.acquisition = call
			return call
		}),
		read: fromPromise(({ input }: { input: Context }) => {
			const data = native(input.native)
			return transactionCall(data.custody, () =>
				capability.readTransaction(
					requirePreparationValue(data.transaction),
					input.intent,
					input.step
				)
			)
		}),
		stage: fromPromise(({ input }: { input: Context }) => {
			const data = native(input.native)
			return transactionCall(data.custody, () =>
				capability.stage(requirePreparationValue(data.transaction), input.intent, input.step)
			)
		}),
		commit: fromPromise(({ input }: { input: Handle }) => {
			const data = native(input)
			const call = transactionCall(data.custody, () =>
				capability.commit(requirePreparationValue(data.transaction))
			)
			data.custody.commit = call
			return call
		}),
		transactionId: fromPromise(({ input }: { input: Handle }) =>
			capability.transactionId(requirePreparationValue(native(input).write))
		),
		local: fromPromise(({ input }: { input: Handle }) =>
			capability.persistLocal(requirePreparationValue(native(input).write))
		),
		global: fromPromise(({ input }: { input: Handle }) =>
			capability.acceptRemote(requirePreparationValue(native(input).write))
		),
		rollback: fromPromise(({ input }: { input: Handle }) => {
			const data = native(input)
			return transactionCall(data.custody, () =>
				capability.rollback(requirePreparationValue(data.transaction))
			)
		})
	}
	const model = setup<
		Context,
		RestorePreparationEvent,
		typeof actors,
		{},
		{ interrupt: undefined },
		{ interrupted: undefined; currentBinding: undefined },
		never,
		string,
		Input,
		RestoreWriteResult<Success>
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding)
		},
		actions: {
			interrupt: assign({
				interruption: ({ event }) =>
					event.type === 'SHUTDOWN'
						? 'closed'
						: event.type === 'INVALIDATE'
							? 'invalidated'
							: 'cancelled'
			})
		}
	})
	const input = ({ context }: { context: Context }) => context
	const handle = ({ context }: { context: Context }) => context.native
	const journalInput = ({ context }: { context: Context }) => ({
		databaseName: context.databaseName,
		binding: context.binding,
		command: {
			mode: 'update',
			expectedRevision: context.record.revision,
			record: requirePreparationValue(context.candidate)
		} satisfies import('../../backup/restore-journal-browser.js').BrowserJournalCommand
	})
	return model.createMachine({
		id: 'restore-write-step',
		context: ({ input }) => ({
			binding: input.binding,
			intent: input.intent,
			databaseName: input.databaseName,
			record: input.record,
			step: selectWrite(input),
			native: allocate(),
			candidate: undefined,
			interruption: undefined,
			outcome: 'incomplete'
		}),
		initial: 'working',
		output: ({ context }) => ({
			binding: context.binding,
			record: context.record,
			outcome: context.interruption ?? context.outcome
		}),
		on: {
			CANCEL: { actions: 'interrupt' },
			SHUTDOWN: { actions: 'interrupt' },
			INVALIDATE: { guard: 'currentBinding', actions: 'interrupt' }
		},
		states: {
			working: {
				initial: 'reconciling',
				invoke: {
					src: 'custodian',
					input: ({ context, self }) => ({ custody: native(context.native).custody, owner: self }),
					onError: '#restore-write-step.complete'
				},
				states: {
					reconciling: {
						invoke: {
							src: 'remote',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#restore-write-step.complete' },
								{
									guard: ({ event }) => event.output === 'conflict',
									target: '#restore-write-step.conflict'
								},
								{
									guard: ({ context, event }) =>
										event.output === 'match' && writeStepCompleted(context.record, context.step),
									target: '#restore-write-step.written'
								},
								{
									guard: ({ context, event }) =>
										event.output === 'match' && writeStepCanReconcile(context.record, context.step),
									target: 'savingContentMatch',
									actions: assign({
										candidate: ({ context }) => reconcileWriteStep(context.record, context.step)
									})
								},
								{
									guard: ({ context, event }) =>
										event.output === 'missingOrHidden' &&
										writeStepNotIssued(context.record, context.step),
									target: 'checkingAuthority'
								},
								{ target: '#restore-write-step.complete' }
							],
							onError: '#restore-write-step.complete'
						}
					},
					checkingAuthority: {
						invoke: {
							src: 'authority',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#restore-write-step.complete' },
								{
									guard: ({ event }) => event.output,
									target: 'savingIntent',
									actions: assign({
										candidate: ({ context }) => issueWriteStep(context.record, context.step)
									})
								},
								{ target: '#restore-write-step.complete' }
							],
							onError: '#restore-write-step.complete'
						}
					},
					savingIntent: {
						invoke: {
							src: 'journal',
							input: journalInput,
							onDone: [
								{
									guard: ({ event }) =>
										(event.output.outcome === 'updated' || event.output.outcome === 'existing') &&
										event.output.record !== undefined,
									target: 'admittingTransaction',
									actions: assign({
										record: ({ event }) => requirePreparationValue(event.output.record)
									})
								},
								{ target: '#restore-write-step.complete' }
							],
							onError: '#restore-write-step.complete'
						}
					},
					admittingTransaction: {
						always: [
							{ guard: 'interrupted', target: '#restore-write-step.complete' },
							{ target: 'opening' }
						]
					},
					opening: {
						invoke: {
							src: 'open',
							input: handle,
							onDone: [
								{
									guard: 'interrupted',
									target: 'rollingBack',
									actions: ({ context, event }) => {
										native(context.native).transaction = event.output
									}
								},
								{
									target: 'readingTransaction',
									actions: ({ context, event }) => {
										native(context.native).transaction = event.output
									}
								}
							],
							onError: '#restore-write-step.complete'
						}
					},
					readingTransaction: {
						invoke: {
							src: 'read',
							input,
							onDone: [
								{ guard: 'interrupted', target: 'rollingBack' },
								{
									guard: ({ event }) => event.output === 'conflict',
									target: 'rollingBack',
									actions: assign({ outcome: 'conflict' })
								},
								{ guard: ({ event }) => event.output === 'missingOrHidden', target: 'staging' },
								{ target: 'rollingBack' }
							],
							onError: 'rollingBack'
						}
					},
					staging: {
						invoke: {
							src: 'stage',
							input,
							onDone: [{ guard: 'interrupted', target: 'rollingBack' }, { target: 'committing' }],
							onError: 'rollingBack'
						}
					},
					committing: {
						invoke: {
							src: 'commit',
							input: handle,
							onDone: {
								target: 'readingTransactionId',
								actions: ({ context, event }) => {
									native(context.native).write = event.output
								}
							},
							onError: '#restore-write-step.complete'
						}
					},
					readingTransactionId: {
						invoke: {
							src: 'transactionId',
							input: handle,
							onDone: {
								target: 'persistingLocal',
								actions: ({ context, event }) => {
									native(context.native).transactionId = event.output
								}
							},
							onError: '#restore-write-step.complete'
						}
					},
					persistingLocal: {
						invoke: {
							src: 'local',
							input: handle,
							onDone: {
								target: 'savingLocal',
								actions: assign({
									candidate: ({ context }) =>
										observeWriteStep(
											context.record,
											context.step,
											requirePreparationValue(native(context.native).transactionId),
											{ local: 'persisted', remote: 'unobserved' }
										)
								})
							},
							onError: {
								target: 'savingLocal',
								actions: assign({
									candidate: ({ context }) =>
										observeWriteStep(
											context.record,
											context.step,
											requirePreparationValue(native(context.native).transactionId),
											{ local: 'unobserved', remote: 'unobserved' }
										)
								})
							}
						}
					},
					savingLocal: {
						invoke: {
							src: 'journal',
							input: journalInput,
							onDone: [
								{
									guard: ({ event }) =>
										(event.output.outcome === 'updated' || event.output.outcome === 'existing') &&
										event.output.record !== undefined,
									target: 'admittingObservation',
									actions: assign({
										record: ({ event }) => requirePreparationValue(event.output.record)
									})
								},
								{ target: '#restore-write-step.complete' }
							],
							onError: '#restore-write-step.complete'
						}
					},
					admittingObservation: {
						always: [
							{ guard: 'interrupted', target: '#restore-write-step.complete' },
							{
								guard: ({ context }) => context.intent.plan.requirements.remote === 'notRequired',
								target: 'checkingSettlement'
							},
							{ target: 'observingRemote' }
						]
					},
					observingRemote: {
						on: {
							CANCEL: { target: '#restore-write-step.complete', actions: 'interrupt' },
							SHUTDOWN: { target: '#restore-write-step.complete', actions: 'interrupt' },
							INVALIDATE: {
								guard: 'currentBinding',
								target: '#restore-write-step.complete',
								actions: 'interrupt'
							}
						},
						invoke: {
							src: 'global',
							input: handle,
							onDone: {
								target: 'savingRemote',
								actions: assign({
									candidate: ({ context }) =>
										observeWriteStep(
											context.record,
											context.step,
											requirePreparationValue(native(context.native).transactionId),
											{
												...writeStepAttempt(context.record, context.step).settlement,
												remote: 'accepted'
											}
										)
								})
							},
							onError: [
								{
									guard: ({ context, event }) =>
										capability.isRemoteRejection(
											event.error,
											requirePreparationValue(native(context.native).transactionId)
										),
									target: 'savingRemote',
									actions: assign({
										candidate: ({ context }) =>
											observeWriteStep(
												context.record,
												context.step,
												requirePreparationValue(native(context.native).transactionId),
												{
													...writeStepAttempt(context.record, context.step).settlement,
													remote: 'rejected'
												}
											)
									})
								},
								{ target: '#restore-write-step.complete' }
							]
						}
					},
					savingRemote: {
						invoke: {
							src: 'journal',
							input: journalInput,
							onDone: [
								{
									guard: ({ event }) =>
										(event.output.outcome === 'updated' || event.output.outcome === 'existing') &&
										event.output.record !== undefined,
									target: 'checkingSettlement',
									actions: assign({
										record: ({ event }) => requirePreparationValue(event.output.record)
									})
								},
								{ target: '#restore-write-step.complete' }
							],
							onError: '#restore-write-step.complete'
						}
					},
					checkingSettlement: {
						always: [
							{
								guard: ({ context }) => writeStepSettlementSatisfied(context.record, context.step),
								target: 'savingCompletion',
								actions: assign({
									candidate: ({ context }) =>
										completeWriteStep(
											context.record,
											context.step,
											writeStepAttempt(context.record, context.step)
										)
								})
							},
							{ target: '#restore-write-step.complete' }
						]
					},
					savingCompletion: {
						invoke: {
							src: 'journal',
							input: journalInput,
							onDone: [
								{
									guard: ({ event }) =>
										(event.output.outcome === 'updated' || event.output.outcome === 'existing') &&
										event.output.record !== undefined,
									target: '#restore-write-step.written',
									actions: [
										assign({ record: ({ event }) => requirePreparationValue(event.output.record) }),
										({ context }) => clearTransactionCustody(native(context.native).custody)
									]
								},
								{ target: '#restore-write-step.complete' }
							],
							onError: '#restore-write-step.complete'
						}
					},
					savingContentMatch: {
						invoke: {
							src: 'journal',
							input: journalInput,
							onDone: [
								{
									guard: ({ event }) =>
										(event.output.outcome === 'updated' || event.output.outcome === 'existing') &&
										event.output.record !== undefined,
									target: '#restore-write-step.written',
									actions: assign({
										record: ({ event }) => requirePreparationValue(event.output.record)
									})
								},
								{ target: '#restore-write-step.complete' }
							],
							onError: '#restore-write-step.complete'
						}
					},
					rollingBack: {
						invoke: {
							src: 'rollback',
							input: handle,
							onDone: [
								{
									guard: ({ event }) => event.output,
									target: '#restore-write-step.complete',
									actions: ({ context }) => clearTransactionCustody(native(context.native).custody)
								},
								{ target: '#restore-write-step.complete' }
							],
							onError: '#restore-write-step.complete'
						}
					}
				}
			},
			written: {
				type: 'final',
				entry: [
					assign({ outcome: completedOutcome }),
					({ context }) => {
						storage.delete(context.native)
					}
				]
			},
			conflict: {
				type: 'final',
				entry: [
					assign({ outcome: 'conflict' }),
					({ context }) => {
						storage.delete(context.native)
					}
				]
			},
			complete: {
				type: 'final',
				entry: ({ context }) => {
					storage.delete(context.native)
				}
			}
		}
	})
}

/** Compatibility entry point: the public preparation coordinator still prepares only its control row. */
export function createRestorePreparationWriteMachine<Transaction, Write>(
	capability: RestorePreparationWriter<Transaction, Write>
) {
	return createRestoreWriteStepMachine(
		capability,
		(input: RestoreWriteInput) => input.intent.plan.preparation,
		'prepared'
	)
}
