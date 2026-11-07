import { forwardTo, assign, fromPromise, setup, type Snapshot } from 'xstate'
import { sameBackupBinding } from '../../backup/binding.js'
import type { RestoreJournalRecord } from '../../backup/restore-journal.js'
import {
	completeWriteStep,
	issueWriteStep,
	observeWriteStep,
	writeStepAttempt,
	writeStepCanReconcile,
	writeStepCanIssue,
	writeStepCompleted,
	writeStepSettlementSatisfied,
	reconcileWriteStep,
	type RestoreDestinationResult,
	type RestoreDestinationLogic,
	type RestoreTransactionWriter,
	type RestoreTransactionAccess,
	type RestoreWriteInput,
	type RestoreWriteResult
} from '../../backup/restore.js'
import { requireRestoreValue, type RestoreEvent } from '../../backup/restore.js'
import {
	clearTransactionCustody,
	createTransactionCustody,
	transactionCall,
	transactionCustodian
} from '../workspaces/transaction-custody.js'
import { createRestoreJournalStepMachine } from './restore-journal-step.js'

/** A checkpoint advances only after a successful CAS and a retained record observation. */
function journalUpdateSucceeded(result: {
	outcome: string
	record: RestoreJournalRecord | undefined
}): boolean {
	return (
		(result.outcome === 'updated' || result.outcome === 'existing') && result.record !== undefined
	)
}

/** One journaled write statechart. Its caller supplies the already selected plan step as data. */
export function createRestoreWriteStepMachine<
	Transaction,
	Write,
	S extends Snapshot<RestoreDestinationResult>
>(
	capability: RestoreTransactionWriter<Transaction, Write>,
	destination: RestoreDestinationLogic<Transaction, S>
) {
	type Native = {
		custody: ReturnType<typeof createTransactionCustody<Transaction, Write>>
		transaction: Transaction | undefined
		write: Write | undefined
		transactionId: string | undefined
	}
	type Handle = { toJSON(): { kind: 'restorePreparationNative' } }
	const storage = new WeakMap<Handle, Native>()
	const native = (handle: Handle) => requireRestoreValue(storage.get(handle))
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
		native: Handle
		candidate: RestoreJournalRecord | undefined
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		outcome: RestoreWriteResult['outcome']
	}
	const actors = {
		journal: createRestoreJournalStepMachine(),
		custodian: transactionCustodian<Transaction, Write>(),
		remote: destination,
		authority: destination,

		open: fromPromise(({ input }: { input: Handle }) => {
			const data = native(input)
			const call = transactionCall(data.custody, () => capability.open())
			data.custody.acquisition = call
			return call
		}),
		read: destination,
		stage: destination,

		commit: fromPromise(({ input }: { input: Handle }) => {
			const data = native(input)
			const call = transactionCall(data.custody, () =>
				capability.commit(requireRestoreValue(data.transaction))
			)
			data.custody.commit = call
			return call
		}),
		transactionId: fromPromise(({ input }: { input: Handle }) =>
			capability.transactionId(requireRestoreValue(native(input).write))
		),
		local: fromPromise(({ input }: { input: Handle }) =>
			capability.persistLocal(requireRestoreValue(native(input).write))
		),
		global: fromPromise(({ input }: { input: Handle }) =>
			capability.acceptRemote(requireRestoreValue(native(input).write))
		),
		rollback: fromPromise(({ input }: { input: Handle }) => {
			const data = native(input)
			return transactionCall(data.custody, () =>
				capability.rollback(requireRestoreValue(data.transaction))
			)
		})
	}
	const model = setup<
		Context,
		RestoreEvent,
		typeof actors,
		{},
		{ interrupt: undefined },
		{ interrupted: undefined; currentBinding: undefined },
		never,
		string,
		RestoreWriteInput,
		RestoreWriteResult
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
	const input = ({ context }: { context: Context }) => ({
		binding: context.binding,
		databaseName: context.databaseName,
		intent: context.intent,
		step: context.step
	})
	const borrow = (handle: Handle): RestoreTransactionAccess<Transaction> => ({
		call: (operation) =>
			transactionCall(native(handle).custody, () =>
				operation(requireRestoreValue(native(handle).transaction))
			),
		toJSON: () => ({ kind: 'restoreTransactionAccess' })
	})

	const handle = ({ context }: { context: Context }) => context.native
	const journalInput = ({ context }: { context: Context }) => ({
		databaseName: context.databaseName,
		binding: context.binding,
		command: {
			mode: 'update',
			expectedRevision: context.record.revision,
			record: requireRestoreValue(context.candidate)
		} satisfies import('../../backup/restore-journal-browser.js').BrowserJournalCommand
	})
	return model.createMachine({
		id: 'restore-write-step',
		context: ({ input }) => ({
			binding: input.binding,
			intent: input.intent,
			databaseName: input.databaseName,
			record: input.record,
			step: input.step,
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
						on: {
							CANCEL: { actions: ['interrupt', forwardTo('destination')] },
							SHUTDOWN: { actions: ['interrupt', forwardTo('destination')] },
							INVALIDATE: {
								guard: 'currentBinding',
								actions: ['interrupt', forwardTo('destination')]
							}
						},

						invoke: {
							id: 'destination',
							src: 'remote',
							input: ({ context }) => ({ ...input({ context }), operation: 'remote' }),
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
										writeStepCanIssue(context.record, context.step),
									target: 'checkingAuthority'
								},
								{ target: '#restore-write-step.complete' }
							],
							onError: '#restore-write-step.complete'
						}
					},
					checkingAuthority: {
						on: {
							CANCEL: { actions: ['interrupt', forwardTo('destination')] },
							SHUTDOWN: { actions: ['interrupt', forwardTo('destination')] },
							INVALIDATE: {
								guard: 'currentBinding',
								actions: ['interrupt', forwardTo('destination')]
							}
						},

						invoke: {
							id: 'destination',
							src: 'authority',
							input: ({ context }) => ({ ...input({ context }), operation: 'authority' }),
							onDone: [
								{ guard: 'interrupted', target: '#restore-write-step.complete' },
								{
									guard: ({ event }) => event.output === 'allowed',
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
									guard: ({ event }) => journalUpdateSucceeded(event.output),
									target: 'admittingTransaction',
									actions: assign({
										record: ({ event }) => requireRestoreValue(event.output.record)
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
						on: {
							CANCEL: { actions: ['interrupt', forwardTo('destination')] },
							SHUTDOWN: { actions: ['interrupt', forwardTo('destination')] },
							INVALIDATE: {
								guard: 'currentBinding',
								actions: ['interrupt', forwardTo('destination')]
							}
						},

						invoke: {
							id: 'destination',
							src: 'read',
							input: ({ context }) => ({
								...input({ context }),
								operation: 'read',
								transaction: borrow(context.native)
							}),
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
						on: {
							CANCEL: { actions: ['interrupt', forwardTo('destination')] },
							SHUTDOWN: { actions: ['interrupt', forwardTo('destination')] },
							INVALIDATE: {
								guard: 'currentBinding',
								actions: ['interrupt', forwardTo('destination')]
							}
						},

						invoke: {
							id: 'destination',
							src: 'stage',
							input: ({ context }) => ({
								...input({ context }),
								operation: 'stage',
								transaction: borrow(context.native)
							}),
							onDone: [
								{ guard: 'interrupted', target: 'rollingBack' },
								{ guard: ({ event }) => event.output === 'staged', target: 'committing' },
								{ target: 'rollingBack' }
							],
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
											requireRestoreValue(native(context.native).transactionId),
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
											requireRestoreValue(native(context.native).transactionId),
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
									guard: ({ event }) => journalUpdateSucceeded(event.output),
									target: 'admittingObservation',
									actions: assign({
										record: ({ event }) => requireRestoreValue(event.output.record)
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
											requireRestoreValue(native(context.native).transactionId),
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
											requireRestoreValue(native(context.native).transactionId)
										),
									target: 'savingRemote',
									actions: assign({
										candidate: ({ context }) =>
											observeWriteStep(
												context.record,
												context.step,
												requireRestoreValue(native(context.native).transactionId),
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
									guard: ({ event }) => journalUpdateSucceeded(event.output),
									target: 'checkingSettlement',
									actions: assign({
										record: ({ event }) => requireRestoreValue(event.output.record)
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
									guard: ({ event }) => journalUpdateSucceeded(event.output),
									target: '#restore-write-step.written',
									actions: [
										assign({ record: ({ event }) => requireRestoreValue(event.output.record) }),
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
									guard: ({ event }) => journalUpdateSucceeded(event.output),
									target: '#restore-write-step.written',
									actions: assign({
										record: ({ event }) => requireRestoreValue(event.output.record)
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
					assign({ outcome: 'written' }),
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
