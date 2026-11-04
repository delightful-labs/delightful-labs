import { assign, fromPromise, setup } from 'xstate'
import { sameBackupBinding } from '../../backup/export.js'
import type { RestoreJournalRecord } from '../../backup/restore-journal.js'
import {
	completePreparation,
	issuePreparation,
	observePreparation,
	preparationAttempt,
	preparationCanReconcile,
	preparationCompleted,
	preparationNotIssued,
	preparationSettlementSatisfied,
	reconciledPreparation
} from '../../backup/restore-preparation-record.js'
import {
	requirePreparationValue,
	type RestorePreparationEvent,
	type RestorePreparationInput,
	type RestorePreparationOutcome,
	type RestorePreparationResult,
	type RestorePreparationWriter
} from '../../backup/restore-preparation.js'
import {
	clearTransactionCustody,
	createTransactionCustody,
	transactionCall,
	transactionCustodian
} from '../workspaces/transaction-custody.js'
import { createRestoreJournalStepMachine } from './restore-journal-step.js'

/** One preparation attempt. No replay or replacement destination on uncertain outcomes. */
export function createRestorePreparationWriteMachine<Transaction, Write>(
	capability: RestorePreparationWriter<Transaction, Write>
) {
	type Input = RestorePreparationInput & { record: RestoreJournalRecord }
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
	type Context = Input & {
		native: Handle
		candidate: RestoreJournalRecord | undefined
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		outcome: RestorePreparationOutcome
	}
	const actors = {
		journal: createRestoreJournalStepMachine(),
		custodian: transactionCustodian<Transaction, Write>(),
		remote: fromPromise(({ input }: { input: Input }) => capability.readRemote(input.intent)),
		authority: fromPromise(({ input }: { input: Input }) =>
			capability.checkAuthority(input.intent)
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
				capability.readTransaction(requirePreparationValue(data.transaction), input.intent)
			)
		}),
		stage: fromPromise(({ input }: { input: Context }) => {
			const data = native(input.native)
			return transactionCall(data.custody, () =>
				capability.stage(requirePreparationValue(data.transaction), input.intent)
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
		RestorePreparationResult
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
		id: 'restore-preparation-write',
		context: ({ input }) => ({
			...input,
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
					onError: '#restore-preparation-write.complete'
				},
				states: {
					reconciling: {
						on: {
							CANCEL: { target: '#restore-preparation-write.complete', actions: 'interrupt' },
							SHUTDOWN: { target: '#restore-preparation-write.complete', actions: 'interrupt' },
							INVALIDATE: {
								guard: 'currentBinding',
								target: '#restore-preparation-write.complete',
								actions: 'interrupt'
							}
						},
						invoke: {
							src: 'remote',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#restore-preparation-write.complete' },
								{
									guard: ({ event }) => event.output === 'conflict',
									target: '#restore-preparation-write.conflict'
								},
								{
									guard: ({ context, event }) =>
										event.output === 'match' && preparationCompleted(context.record),
									target: '#restore-preparation-write.prepared'
								},
								{
									guard: ({ context, event }) =>
										event.output === 'match' && preparationCanReconcile(context.record),
									target: 'savingContentMatch',
									actions: assign({
										candidate: ({ context }) => reconciledPreparation(context.record)
									})
								},
								{
									guard: ({ context, event }) =>
										event.output === 'missingOrHidden' && preparationNotIssued(context.record),
									target: 'checkingAuthority'
								},
								{ target: '#restore-preparation-write.complete' }
							],
							onError: '#restore-preparation-write.complete'
						}
					},
					checkingAuthority: {
						on: {
							CANCEL: { target: '#restore-preparation-write.complete', actions: 'interrupt' },
							SHUTDOWN: { target: '#restore-preparation-write.complete', actions: 'interrupt' },
							INVALIDATE: {
								guard: 'currentBinding',
								target: '#restore-preparation-write.complete',
								actions: 'interrupt'
							}
						},
						invoke: {
							src: 'authority',
							input,
							onDone: [
								{ guard: 'interrupted', target: '#restore-preparation-write.complete' },
								{
									guard: ({ event }) => event.output,
									target: 'savingIntent',
									actions: assign({ candidate: ({ context }) => issuePreparation(context.record) })
								},
								{ target: '#restore-preparation-write.complete' }
							],
							onError: '#restore-preparation-write.complete'
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
								{ target: '#restore-preparation-write.complete' }
							],
							onError: '#restore-preparation-write.complete'
						}
					},
					admittingTransaction: {
						always: [
							{ guard: 'interrupted', target: '#restore-preparation-write.complete' },
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
							onError: '#restore-preparation-write.complete'
						}
					},
					readingTransaction: {
						invoke: {
							src: 'read',
							input,
							onDone: [
								{ guard: 'interrupted', target: 'rollingBack' },
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
							onError: '#restore-preparation-write.complete'
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
							onError: '#restore-preparation-write.complete'
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
										observePreparation(
											context.record,
											requirePreparationValue(native(context.native).transactionId),
											{ local: 'persisted', remote: 'unobserved' }
										)
								})
							},
							onError: {
								target: 'savingLocal',
								actions: assign({
									candidate: ({ context }) =>
										observePreparation(
											context.record,
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
								{ target: '#restore-preparation-write.complete' }
							],
							onError: '#restore-preparation-write.complete'
						}
					},
					admittingObservation: {
						always: [
							{ guard: 'interrupted', target: '#restore-preparation-write.complete' },
							{
								guard: ({ context }) => context.intent.plan.requirements.remote === 'notRequired',
								target: 'checkingSettlement'
							},
							{ target: 'observingRemote' }
						]
					},
					observingRemote: {
						on: {
							CANCEL: { target: '#restore-preparation-write.complete', actions: 'interrupt' },
							SHUTDOWN: { target: '#restore-preparation-write.complete', actions: 'interrupt' },
							INVALIDATE: {
								guard: 'currentBinding',
								target: '#restore-preparation-write.complete',
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
										observePreparation(
											context.record,
											requirePreparationValue(native(context.native).transactionId),
											{ ...preparationAttempt(context.record).settlement, remote: 'accepted' }
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
											observePreparation(
												context.record,
												requirePreparationValue(native(context.native).transactionId),
												{ ...preparationAttempt(context.record).settlement, remote: 'rejected' }
											)
									})
								},
								{ target: '#restore-preparation-write.complete' }
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
								{ target: '#restore-preparation-write.complete' }
							],
							onError: '#restore-preparation-write.complete'
						}
					},
					checkingSettlement: {
						always: [
							{
								guard: ({ context }) => preparationSettlementSatisfied(context.record),
								target: 'savingCompletion',
								actions: assign({
									candidate: ({ context }) =>
										completePreparation(context.record, preparationAttempt(context.record))
								})
							},
							{ target: '#restore-preparation-write.complete' }
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
									target: '#restore-preparation-write.prepared',
									actions: [
										assign({ record: ({ event }) => requirePreparationValue(event.output.record) }),
										({ context }) => clearTransactionCustody(native(context.native).custody)
									]
								},
								{ target: '#restore-preparation-write.complete' }
							],
							onError: '#restore-preparation-write.complete'
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
									target: '#restore-preparation-write.prepared',
									actions: assign({
										record: ({ event }) => requirePreparationValue(event.output.record)
									})
								},
								{ target: '#restore-preparation-write.complete' }
							],
							onError: '#restore-preparation-write.complete'
						}
					},
					rollingBack: {
						invoke: {
							src: 'rollback',
							input: handle,
							onDone: [
								{
									guard: ({ event }) => event.output,
									target: '#restore-preparation-write.complete',
									actions: ({ context }) => clearTransactionCustody(native(context.native).custody)
								},
								{ target: '#restore-preparation-write.complete' }
							],
							onError: '#restore-preparation-write.complete'
						}
					}
				}
			},
			prepared: {
				type: 'final',
				entry: [
					assign({ outcome: 'prepared' }),
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
