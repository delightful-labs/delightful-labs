import { types, createAsyncLogic, createCallbackLogic, setup, type Snapshot } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
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
	type Handle = {
		toJSON(): {
			kind: 'restorePreparationNative'
		}
	}
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
		clearCustody: createCallbackLogic<{ type: string }, Handle>(({ input, sendBack }) => {
			clearTransactionCustody(native(input).custody)
			sendBack({ type: 'CUSTODY_CLEARED' })
		}),
		journal: createRestoreJournalStepMachine(),
		custodian: transactionCustodian<Transaction, Write>(),
		remote: destination,
		authority: destination,
		open: createAsyncLogic({
			run: ({ input }: { input: Handle }) => {
				const data = native(input)
				const call = transactionCall(data.custody, () => capability.open())
				data.custody.recordAcquisition(call)
				return call
			}
		}),
		read: destination,
		stage: destination,
		commit: createAsyncLogic({
			run: ({ input }: { input: Handle }) => {
				const data = native(input)
				const call = transactionCall(data.custody, () =>
					capability.commit(requireRestoreValue(data.transaction))
				)
				data.custody.recordCommit(call)
				return call
			}
		}),
		transactionId: createAsyncLogic({
			run: ({ input }: { input: Handle }) =>
				capability.transactionId(requireRestoreValue(native(input).write))
		}),
		local: createAsyncLogic({
			run: ({ input }: { input: Handle }) =>
				capability.persistLocal(requireRestoreValue(native(input).write))
		}),
		global: createAsyncLogic({
			run: ({ input }: { input: Handle }) =>
				capability.acceptRemote(requireRestoreValue(native(input).write))
		}),
		rollback: createAsyncLogic({
			run: ({ input }: { input: Handle }) => {
				const data = native(input)
				return transactionCall(data.custody, () =>
					capability.rollback(requireRestoreValue(data.transaction))
				)
			}
		})
	}
	const patches = {
		interrupt: ({ event }: { context: Context; event: RestoreEvent }): Partial<Context> => ({
			interruption:
				event.type === 'SHUTDOWN'
					? 'closed'
					: event.type === 'INVALIDATE'
						? 'invalidated'
						: 'cancelled'
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<RestoreEvent, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<RestoreEvent, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<RestoreEvent, 'INVALIDATE'>>(),
				CUSTODY_CLEARED: types<{}>()
			},
			input: types<RestoreWriteInput>(),
			output: types<RestoreWriteResult>()
		},
		actors,
		guards: {
			interrupted: ({ context }: { context: Context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }: { context: Context; event: RestoreEvent }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding)
		},
		actions: {}
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
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		written: (args, enq) => {
			let context = args.context
			let patch = {}
			patch = { ...patch, outcome: 'written' }
			context = { ...args.context, ...patch }
			enq(
				({ context }) => {
					storage.delete(context.native)
				},
				{ ...args, context }
			)
			return { context: patch satisfies Partial<Context> }
		},
		conflict: (args, enq) => {
			let context = args.context
			let patch = {}
			patch = { ...patch, outcome: 'conflict' }
			context = { ...args.context, ...patch }
			enq(
				({ context }) => {
					storage.delete(context.native)
				},
				{ ...args, context }
			)
			return { context: patch satisfies Partial<Context> }
		},
		complete: (args, enq) => {
			enq(({ context }: CompletionArgs) => {
				storage.delete(context.native)
			}, args)
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>

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
			CANCEL: (args) => {
				return { context: patches.interrupt(args) satisfies Partial<Context> }
			},
			SHUTDOWN: (args) => {
				return { context: patches.interrupt(args) satisfies Partial<Context> }
			},
			INVALIDATE: (args) => {
				if (!args.guards.currentBinding(args)) return
				return { context: patches.interrupt(args) satisfies Partial<Context> }
			}
		},
		states: {
			working: {
				initial: 'reconciling',
				invoke: model.createInvoke<typeof actors.custodian, Context>({
					src: actors.custodian,
					input: ({ context, self }) => ({ custody: native(context.native).custody, owner: self }),
					onError: (_args) => {
						return { target: '#restore-write-step.complete' }
					}
				}),
				states: {
					reconciling: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							INVALIDATE: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							}
						},
						invoke: model.createInvoke<typeof actors.remote, Context>({
							id: 'destination',
							src: actors.remote,
							input: ({ context }) => ({ ...input({ context }), operation: 'remote' }),
							onDone: (args) => {
								const { context, event } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#restore-write-step.complete'
									}
								}
								if (event.output === 'conflict') {
									return {
										target: '#restore-write-step.conflict'
									}
								}
								if (event.output === 'match' && writeStepCompleted(context.record, context.step)) {
									return { target: '#restore-write-step.written' }
								}
								if (
									event.output === 'match' &&
									writeStepCanReconcile(context.record, context.step)
								) {
									return {
										target: 'savingContentMatch',
										context: {
											candidate: reconcileWriteStep(context.record, context.step)
										} satisfies Partial<Context>
									}
								}
								if (
									event.output === 'missingOrHidden' &&
									writeStepCanIssue(context.record, context.step)
								) {
									return { target: 'checkingAuthority' }
								}

								return { target: '#restore-write-step.complete' }
							},
							onError: (_args) => {
								return { target: '#restore-write-step.complete' }
							}
						})
					},
					checkingAuthority: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							INVALIDATE: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							}
						},
						invoke: model.createInvoke<typeof actors.authority, Context>({
							id: 'destination',
							src: actors.authority,
							input: ({ context }) => ({ ...input({ context }), operation: 'authority' }),
							onDone: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#restore-write-step.complete'
									}
								}
								if (args.event.output === 'allowed') {
									return {
										target: 'savingIntent',
										context: {
											candidate: issueWriteStep(context.record, context.step)
										} satisfies Partial<Context>
									}
								}

								return { target: '#restore-write-step.complete' }
							},
							onError: (_args) => {
								return { target: '#restore-write-step.complete' }
							}
						})
					},
					savingIntent: {
						invoke: model.createInvoke<typeof actors.journal, Context>({
							src: actors.journal,
							input: journalInput,
							onDone: (args) => {
								const { event } = args
								if (journalUpdateSucceeded(event.output)) {
									return {
										target: 'admittingTransaction',
										context: {
											record: requireRestoreValue(event.output.record)
										} satisfies Partial<Context>
									}
								}

								return { target: '#restore-write-step.complete' }
							},
							onError: (_args) => {
								return { target: '#restore-write-step.complete' }
							}
						})
					},
					admittingTransaction: {
						type: 'choice',
						choice: (args) => {
							if (args.guards.interrupted(args)) {
								return { target: '#restore-write-step.complete' }
							}
							return { target: 'opening' }
						}
					},
					opening: {
						invoke: model.createInvoke<typeof actors.open, Context>({
							src: actors.open,
							input: handle,
							onDone: (args, enq) => {
								if (args.guards.interrupted(args)) {
									enq(({ context, event }) => {
										native(context.native).transaction = event.output
									}, args)
									return { target: 'rollingBack' }
								}
								enq(({ context, event }) => {
									native(context.native).transaction = event.output
								}, args)
								return { target: 'readingTransaction' }
							},
							onError: (_args) => {
								return { target: '#restore-write-step.complete' }
							}
						})
					},
					readingTransaction: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							INVALIDATE: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							}
						},
						invoke: model.createInvoke<typeof actors.read, Context>({
							id: 'destination',
							src: actors.read,
							input: ({ context }) => ({
								...input({ context }),
								operation: 'read',
								transaction: borrow(context.native)
							}),
							onDone: (args) => {
								const { event } = args
								if (args.guards.interrupted(args)) {
									return { target: 'rollingBack' }
								}
								if (event.output === 'conflict') {
									return {
										target: 'rollingBack',
										context: { outcome: 'conflict' } satisfies Partial<Context>
									}
								}
								if (event.output === 'missingOrHidden') {
									return { target: 'staging' }
								}
								return { target: 'rollingBack' }
							},
							onError: { target: 'rollingBack' }
						})
					},
					staging: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							INVALIDATE: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo('destination', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							}
						},
						invoke: model.createInvoke<typeof actors.stage, Context>({
							id: 'destination',
							src: actors.stage,
							input: ({ context }) => ({
								...input({ context }),
								operation: 'stage',
								transaction: borrow(context.native)
							}),
							onDone: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: 'rollingBack' }
								}
								if (args.event.output === 'staged') {
									return { target: 'committing' }
								}
								return { target: 'rollingBack' }
							},
							onError: { target: 'rollingBack' }
						})
					},
					committing: {
						invoke: model.createInvoke<typeof actors.commit, Context>({
							src: actors.commit,
							input: handle,
							onDone: (args, enq) => {
								enq(({ context, event }) => {
									native(context.native).write = event.output
								}, args)
								return { target: 'readingTransactionId' }
							},
							onError: (_args) => {
								return { target: '#restore-write-step.complete' }
							}
						})
					},
					readingTransactionId: {
						invoke: model.createInvoke<typeof actors.transactionId, Context>({
							src: actors.transactionId,
							input: handle,
							onDone: (args, enq) => {
								enq(({ context, event }) => {
									native(context.native).transactionId = event.output
								}, args)
								return { target: 'persistingLocal' }
							},
							onError: (_args) => {
								return { target: '#restore-write-step.complete' }
							}
						})
					},
					persistingLocal: {
						invoke: model.createInvoke<typeof actors.local, Context>({
							src: actors.local,
							input: handle,
							onDone: (args) => {
								const { context } = args
								return {
									target: 'savingLocal',
									context: {
										candidate: observeWriteStep(
											context.record,
											context.step,
											requireRestoreValue(native(context.native).transactionId),
											{ local: 'persisted', remote: 'unobserved' }
										)
									} satisfies Partial<Context>
								}
							},
							onError: (args) => {
								const { context } = args
								return {
									target: 'savingLocal',
									context: {
										candidate: observeWriteStep(
											context.record,
											context.step,
											requireRestoreValue(native(context.native).transactionId),
											{ local: 'unobserved', remote: 'unobserved' }
										)
									} satisfies Partial<Context>
								}
							}
						})
					},
					savingLocal: {
						invoke: model.createInvoke<typeof actors.journal, Context>({
							src: actors.journal,
							input: journalInput,
							onDone: (args) => {
								const { event } = args
								if (journalUpdateSucceeded(event.output)) {
									return {
										target: 'admittingObservation',
										context: {
											record: requireRestoreValue(event.output.record)
										} satisfies Partial<Context>
									}
								}

								return { target: '#restore-write-step.complete' }
							},
							onError: (_args) => {
								return { target: '#restore-write-step.complete' }
							}
						})
					},
					admittingObservation: {
						type: 'choice',
						choice: (args) => {
							if (args.guards.interrupted(args)) {
								return { target: '#restore-write-step.complete' }
							}
							if (args.context.intent.plan.requirements.remote === 'notRequired') {
								return { target: 'checkingSettlement' }
							}
							return { target: 'observingRemote' }
						}
					},
					observingRemote: {
						on: {
							CANCEL: (args) => {
								return {
									target: '#restore-write-step.complete',
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							SHUTDOWN: (args) => {
								return {
									target: '#restore-write-step.complete',
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							INVALIDATE: (args) => {
								if (!args.guards.currentBinding(args)) return

								return {
									target: '#restore-write-step.complete',
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							}
						},
						invoke: model.createInvoke<typeof actors.global, Context>({
							src: actors.global,
							input: handle,
							onDone: (args) => {
								const { context } = args
								return {
									target: 'savingRemote',
									context: {
										candidate: observeWriteStep(
											context.record,
											context.step,
											requireRestoreValue(native(context.native).transactionId),
											{
												...writeStepAttempt(context.record, context.step).settlement,
												remote: 'accepted'
											}
										)
									} satisfies Partial<Context>
								}
							},
							onError: (args) => {
								const { context } = args
								if (
									capability.isRemoteRejection(
										args.event.error,
										requireRestoreValue(native(context.native).transactionId)
									)
								) {
									return {
										target: 'savingRemote',
										context: {
											candidate: observeWriteStep(
												context.record,
												context.step,
												requireRestoreValue(native(context.native).transactionId),
												{
													...writeStepAttempt(context.record, context.step).settlement,
													remote: 'rejected'
												}
											)
										} satisfies Partial<Context>
									}
								}

								return { target: '#restore-write-step.complete' }
							}
						})
					},
					savingRemote: {
						invoke: model.createInvoke<typeof actors.journal, Context>({
							src: actors.journal,
							input: journalInput,
							onDone: (args) => {
								const { event } = args
								if (journalUpdateSucceeded(event.output)) {
									return {
										target: 'checkingSettlement',
										context: {
											record: requireRestoreValue(event.output.record)
										} satisfies Partial<Context>
									}
								}

								return { target: '#restore-write-step.complete' }
							},
							onError: (_args) => {
								return { target: '#restore-write-step.complete' }
							}
						})
					},
					checkingSettlement: {
						always: (args) => {
							const { context } = args
							if (writeStepSettlementSatisfied(context.record, context.step)) {
								return {
									target: 'savingCompletion',
									context: {
										candidate: completeWriteStep(
											context.record,
											context.step,
											writeStepAttempt(context.record, context.step)
										)
									} satisfies Partial<Context>
								}
							}

							return { target: '#restore-write-step.complete' }
						}
					},
					savingCompletion: {
						invoke: model.createInvoke<typeof actors.journal, Context>({
							src: actors.journal,
							input: journalInput,
							onDone: (args) => {
								const { event } = args
								if (journalUpdateSucceeded(event.output)) {
									let patch = {}
									patch = { ...patch, record: requireRestoreValue(event.output.record) }

									return {
										target: '#restore-write-step.working.releasingWritten',
										context: patch satisfies Partial<Context>
									}
								}

								return { target: '#restore-write-step.complete' }
							},
							onError: (_args) => {
								return { target: '#restore-write-step.complete' }
							}
						})
					},
					savingContentMatch: {
						invoke: model.createInvoke<typeof actors.journal, Context>({
							src: actors.journal,
							input: journalInput,
							onDone: (args) => {
								const { event } = args
								if (journalUpdateSucceeded(event.output)) {
									return {
										target: '#restore-write-step.written',
										context: {
											record: requireRestoreValue(event.output.record)
										} satisfies Partial<Context>
									}
								}

								return { target: '#restore-write-step.complete' }
							},
							onError: (_args) => {
								return { target: '#restore-write-step.complete' }
							}
						})
					},
					// Keep the custodian alive until the native clear reports completion.
					releasingWritten: {
						invoke: { src: actors.clearCustody, input: handle },
						on: { CUSTODY_CLEARED: { target: '#restore-write-step.written' } }
					},
					releasingRollback: {
						invoke: { src: actors.clearCustody, input: handle },
						on: { CUSTODY_CLEARED: { target: '#restore-write-step.complete' } }
					},

					rollingBack: {
						invoke: model.createInvoke<typeof actors.rollback, Context>({
							src: actors.rollback,
							input: handle,
							onDone: (args) => {
								if (args.event.output) {
									return {
										target: '#restore-write-step.working.releasingRollback'
									}
								}

								return { target: '#restore-write-step.complete' }
							},
							onError: (_args) => {
								return { target: '#restore-write-step.complete' }
							}
						})
					}
				}
			},
			written: {
				type: 'final',
				entry: finalizers.written
			},
			conflict: {
				type: 'final',
				entry: finalizers.conflict
			},
			complete: {
				type: 'final',
				entry: finalizers.complete
			}
		}
	})
}
