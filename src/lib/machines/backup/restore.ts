import { types, setup, type Snapshot } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import { sameBackupBinding } from '../../backup/binding.js'
import {
	createRestoreJournalRecord,
	type RestoreJournalRecord
} from '../../backup/restore-journal.js'
import { createRestoreJournalStepMachine } from './restore-journal-step.js'
import { createRestoreWriteStepMachine } from './restore-write-step.js'
import {
	requireRestoreValue,
	validateRestoreInput,
	requestedBatchIsCurrent,
	type RestoreInput,
	type RestoreEvent,
	type RestoreResult,
	type RestoreOutcome,
	type RestorePlannedWrite,
	type RestoreDestinationResult,
	type RestoreDestinationLogic,
	type RestoreTransactionWriter
} from '../../backup/restore.js'
import { operationLock, type LockEvent } from './restore-operation-lock.js'
/** One selected write per invocation. Only preparation may initialize a missing durable intent. */
export function createRestoreMachine<
	Transaction,
	Write,
	S extends Snapshot<RestoreDestinationResult>
>(
	writer: RestoreTransactionWriter<Transaction, Write>,
	destination: RestoreDestinationLogic<Transaction, S>
) {
	type Context = RestoreInput & {
		step: RestorePlannedWrite | undefined
		record: RestoreJournalRecord | undefined
		outcome: RestoreOutcome
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
	}
	const actors = {
		lock: operationLock,
		journal: createRestoreJournalStepMachine(),
		write: createRestoreWriteStepMachine(writer, destination)
	}
	const patches = {
		interrupt: ({
			event
		}: {
			context: Context
			event:
				| RestoreEvent
				| LockEvent
				| {
						type: 'INPUT_VALIDATED'
						value: ReturnType<typeof validateRestoreInput>
				  }
				| {
						type: 'INPUT_INVALID'
				  }
		}): Partial<Context> => ({
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
				CANCEL: types<
					EventPayload<
						| RestoreEvent
						| LockEvent
						| {
								type: 'INPUT_VALIDATED'
								value: ReturnType<typeof validateRestoreInput>
						  }
						| {
								type: 'INPUT_INVALID'
						  },
						'CANCEL'
					>
				>(),
				SHUTDOWN: types<
					EventPayload<
						| RestoreEvent
						| LockEvent
						| {
								type: 'INPUT_VALIDATED'
								value: ReturnType<typeof validateRestoreInput>
						  }
						| {
								type: 'INPUT_INVALID'
						  },
						'SHUTDOWN'
					>
				>(),
				INVALIDATE: types<
					EventPayload<
						| RestoreEvent
						| LockEvent
						| {
								type: 'INPUT_VALIDATED'
								value: ReturnType<typeof validateRestoreInput>
						  }
						| {
								type: 'INPUT_INVALID'
						  },
						'INVALIDATE'
					>
				>(),
				LOCK_ACQUIRED: types<
					EventPayload<
						| RestoreEvent
						| LockEvent
						| {
								type: 'INPUT_VALIDATED'
								value: ReturnType<typeof validateRestoreInput>
						  }
						| {
								type: 'INPUT_INVALID'
						  },
						'LOCK_ACQUIRED'
					>
				>(),
				LOCK_FAILED: types<
					EventPayload<
						| RestoreEvent
						| LockEvent
						| {
								type: 'INPUT_VALIDATED'
								value: ReturnType<typeof validateRestoreInput>
						  }
						| {
								type: 'INPUT_INVALID'
						  },
						'LOCK_FAILED'
					>
				>(),
				INPUT_VALIDATED: types<
					EventPayload<
						| RestoreEvent
						| LockEvent
						| {
								type: 'INPUT_VALIDATED'
								value: ReturnType<typeof validateRestoreInput>
						  }
						| {
								type: 'INPUT_INVALID'
						  },
						'INPUT_VALIDATED'
					>
				>(),
				INPUT_INVALID: types<
					EventPayload<
						| RestoreEvent
						| LockEvent
						| {
								type: 'INPUT_VALIDATED'
								value: ReturnType<typeof validateRestoreInput>
						  }
						| {
								type: 'INPUT_INVALID'
						  },
						'INPUT_INVALID'
					>
				>()
			},
			input: types<RestoreInput>(),
			output: types<RestoreResult>()
		},
		actors,
		guards: {
			interrupted: ({ context }: { context: Context }) => context.interruption !== undefined,
			currentBinding: ({
				context,
				event
			}: {
				context: Context
				event:
					| RestoreEvent
					| LockEvent
					| {
							type: 'INPUT_VALIDATED'
							value: ReturnType<typeof validateRestoreInput>
					  }
					| {
							type: 'INPUT_INVALID'
					  }
			}) => event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding)
		},
		actions: {}
	})
	const input = ({ context }: { context: Context }) => ({
		binding: context.binding,
		databaseName: context.databaseName,
		intent: context.intent,
		writeId: context.writeId
	})
	return model.createMachine({
		id: 'restore',
		context: ({ input }) => ({
			...input,
			record: undefined,
			step: undefined,
			outcome: 'unavailable',
			interruption: undefined
		}),
		initial: 'validating',
		output: ({ context }) => ({
			binding: context.binding,
			outcome: context.interruption ?? context.outcome,
			record: context.record
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
			validating: {
				entry: ({ context, self }) => {
					try {
						self.send({ type: 'INPUT_VALIDATED', value: validateRestoreInput(input({ context })) })
					} catch {
						self.send({ type: 'INPUT_INVALID' })
					}
				},
				on: {
					INPUT_VALIDATED: (args) => {
						const { event } = args
						if (args.guards.interrupted(args)) {
							return { target: 'complete' }
						}
						return {
							target: 'owned',
							context: {
								step: event.value.step,
								binding: event.value.binding,
								intent: event.value.record.intent
							} satisfies Partial<Context>
						}
					},
					INPUT_INVALID: { target: 'complete' }
				}
			},
			owned: {
				initial: 'acquiring',
				invoke: model.createInvoke<typeof actors.lock, Context>({
					id: 'lock',
					src: actors.lock,
					input,
					onDone: (args) => {
						if (args.event.output === 'failed') {
							return {
								target: 'complete',
								context: {
									outcome: 'incomplete',
									interruption: undefined
								} satisfies Partial<Context>
							}
						}
						return { target: 'complete' }
					},
					onError: (_args) => {
						return {
							target: 'complete',
							context: { outcome: 'incomplete', interruption: undefined } satisfies Partial<Context>
						}
					}
				}),
				on: {
					LOCK_FAILED: (_args) => {
						return { context: { interruption: 'closed' } satisfies Partial<Context> }
					}
				},
				states: {
					releasing: {
						id: 'release-restore-lock',
						entry: (args, enq) => {
							enq.sendTo('lock', { type: 'RELEASE' })
						}
					},
					acquiring: {
						on: {
							LOCK_ACQUIRED: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#release-restore-lock' }
								}
								return { target: 'loading' }
							},
							CANCEL: (args) => {
								return {
									target: '#release-restore-lock',
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							SHUTDOWN: (args) => {
								return {
									target: '#release-restore-lock',
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							INVALIDATE: (args) => {
								if (!args.guards.currentBinding(args)) return
								return {
									target: '#release-restore-lock',
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							}
						}
					},
					loading: {
						invoke: model.createInvoke<typeof actors.journal, Context>({
							src: actors.journal,
							input: ({ context }) => ({
								databaseName: context.databaseName,
								binding: context.binding,
								command: { mode: 'load', intent: context.intent }
							}),
							onDone: (args) => {
								const { context, event } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#release-restore-lock',
										context: { record: event.output.record } satisfies Partial<Context>
									}
								}
								if (event.output.outcome === 'loaded' && event.output.record !== undefined) {
									return {
										target: 'admittingWrite',
										context: {
											record: requireRestoreValue(event.output.record)
										} satisfies Partial<Context>
									}
								}
								if (
									event.output.outcome === 'missing' &&
									context.writeId === context.intent.plan.preparation.writeId
								) {
									return { target: 'creatingIntent' }
								}
								if (event.output.outcome === 'conflict') {
									return {
										target: '#release-restore-lock',
										context: { outcome: 'conflict' } satisfies Partial<Context>
									}
								}
								return { target: '#release-restore-lock' }
							},
							onError: { target: '#release-restore-lock' }
						})
					},
					creatingIntent: {
						invoke: model.createInvoke<typeof actors.journal, Context>({
							src: actors.journal,
							input: ({ context }) => ({
								databaseName: context.databaseName,
								binding: context.binding,
								command: { mode: 'create', record: createRestoreJournalRecord(context.intent) }
							}),
							onDone: (args) => {
								const { event } = args
								if (
									(event.output.outcome === 'created' || event.output.outcome === 'existing') &&
									event.output.record !== undefined
								) {
									return {
										target: 'admittingWrite',
										context: {
											record: requireRestoreValue(event.output.record)
										} satisfies Partial<Context>
									}
								}
								if (event.output.outcome === 'conflict') {
									return {
										target: '#release-restore-lock',
										context: { outcome: 'conflict' } satisfies Partial<Context>
									}
								}
								return { target: '#release-restore-lock' }
							},
							onError: { target: '#release-restore-lock' }
						})
					},
					admittingWrite: {
						always: (args) => {
							const { context } = args
							if (args.guards.interrupted(args)) {
								return { target: '#release-restore-lock' }
							}
							if (context.record?.checkpoint.kind === 'conflict') {
								return {
									target: '#release-restore-lock',
									context: { outcome: 'conflict' } satisfies Partial<Context>
								}
							}
							if (
								context.writeId === context.intent.plan.preparation.writeId ||
								requestedBatchIsCurrent(context.record, context.writeId) ||
								((context.record?.checkpoint.kind === 'activating' ||
									context.record?.checkpoint.kind === 'complete') &&
									context.writeId === context.intent.plan.activation.writeId)
							) {
								return { target: 'writing' }
							}
							return {
								target: '#release-restore-lock',
								context: { outcome: 'incomplete' } satisfies Partial<Context>
							}
						}
					},
					writing: {
						on: {
							LOCK_FAILED: (args, enq) => {
								enq.sendTo('write', { type: 'SHUTDOWN' })
								return {
									context: { interruption: 'closed' } satisfies Partial<Context>
								}
							},
							CANCEL: (args, enq) => {
								enq.sendTo('write', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('write', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							},
							INVALIDATE: (args, enq) => {
								if (!args.guards.currentBinding(args)) return
								enq.sendTo('write', args.event)
								return {
									context: patches.interrupt(args) satisfies Partial<Context>
								}
							}
						},
						invoke: model.createInvoke<typeof actors.write, Context>({
							id: 'write',
							src: actors.write,
							input: ({ context }) => ({
								...input({ context }),
								record: requireRestoreValue(context.record),
								step: requireRestoreValue(context.step)
							}),
							onDone: (args) => {
								const { context, event } = args
								if (
									event.output.outcome === 'written' &&
									context.writeId === context.intent.plan.preparation.writeId
								) {
									return {
										target: '#release-restore-lock',
										context: {
											outcome: 'prepared',
											record: event.output.record
										} satisfies Partial<Context>
									}
								}
								if (
									event.output.outcome === 'written' &&
									context.writeId === context.intent.plan.activation.writeId
								) {
									return {
										target: '#release-restore-lock',
										context: {
											outcome: 'complete',
											record: event.output.record
										} satisfies Partial<Context>
									}
								}
								if (event.output.outcome === 'written') {
									return {
										target: '#release-restore-lock',
										context: {
											outcome: 'batchWritten',
											record: event.output.record
										} satisfies Partial<Context>
									}
								}
								if (event.output.outcome === 'conflict') {
									return {
										target: '#release-restore-lock',
										context: {
											outcome: 'conflict',
											record: event.output.record
										} satisfies Partial<Context>
									}
								}
								return {
									target: '#release-restore-lock',
									context: {
										outcome: 'incomplete',
										record: event.output.record
									} satisfies Partial<Context>
								}
							},
							onError: (_args) => {
								return {
									target: '#release-restore-lock',
									context: { outcome: 'incomplete' } satisfies Partial<Context>
								}
							}
						})
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
export { createRestoreJournalStepMachine } from './restore-journal-step.js'
