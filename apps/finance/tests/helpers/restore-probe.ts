import { setup, types, createAsyncLogic } from 'xstate'
import type { Transaction, WriteHandle } from 'jazz-tools'
import { createRestoreMachine } from 'delightful-local-first/backup/restore/workflow'
import type {
	RestoreDestinationInput,
	RestoreDestinationResult,
	RestoreEvent,
	RestoreTransactionWriter
} from 'delightful-local-first/backup/restore'
import { sameBackupBinding } from 'delightful-local-first/backup/binding'
import type { IntegrityCheckedArchive } from 'delightful-local-first/backup/envelope'
import {
	createFinanceRestoreAdapter,
	type FinanceRestoreDb
} from '../../src/lib/machines/workspaces/workspace-restore.js'
import type { FinanceRestorePlan } from '../../src/lib/machines/workspaces/workspace-restore-plan.js'

declare global {
	interface Window {
		pauseRecoveryReplies(): Promise<void>
	}
}

export type RecoveryInput = RestoreDestinationInput<Transaction<'mergeable'>>
/** Instrumentation only: the application owns every native read, comparison and transaction. */
export function createRecoveryProbe(
	db: FinanceRestoreDb,
	sample: FinanceRestorePlan,
	archive: IntegrityCheckedArchive,
	heldWriteId?: string,
	retain?: RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached'],
	isCurrent: () => boolean = () => true
) {
	const detached: Parameters<
		RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
	>[0][] = []
	const adapter = createFinanceRestoreAdapter(
		db,
		sample,
		archive,
		retain ?? ((receipt) => detached.push(receipt)),
		isCurrent
	)
	const commits: string[] = []
	const commit = adapter.writer.commit
	adapter.writer.commit = (tx) => {
		const write = commit(tx)
		void Promise.resolve(write)
			.then((value) => adapter.writer.transactionId(value))
			.then(
				(id) => commits.push(id),
				() => {}
			)
		return write
	}
	const actors = {
		native: adapter.destination,
		pause: createAsyncLogic({ run: () => window.pauseRecoveryReplies() })
	}
	type ProbeContext = {
		input: RecoveryInput
		result: RestoreDestinationResult
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
	}
	const guarded = setup({
		schemas: {
			context: types<ProbeContext>(),
			input: types<RecoveryInput>(),
			output: types<RestoreDestinationResult>(),
			events: {
				CANCEL: types(),
				SHUTDOWN: types(),
				INVALIDATE: types<{ binding: RecoveryInput['binding'] }>()
			},
			children: { native: types<import('xstate').ActorRefFrom<typeof actors.native>>() }
		},
		actors
	})
	const latch = ({ context, event }: { context: ProbeContext; event: RestoreEvent }) =>
		({
			interruption:
				event.type === 'SHUTDOWN'
					? 'closed'
					: (context.interruption ?? (event.type === 'CANCEL' ? 'cancelled' : 'invalidated'))
		}) satisfies Pick<ProbeContext, 'interruption'>

	const wire = guarded.createMachine({
		context: ({ input }) => ({ input, result: 'unavailable', interruption: undefined }),
		initial: 'checking',
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: (args) => ({ context: latch(args) }),
			SHUTDOWN: (args) => ({ context: latch(args) }),
			INVALIDATE: (args) => {
				if (sameBackupBinding(args.context.input.binding, args.event.binding))
					return { context: latch(args) }
			}
		},
		states: {
			checking: {
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('native', args.event)
						return { context: latch(args) }
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('native', args.event)
						return { context: latch(args) }
					},
					INVALIDATE: (args, enq) => {
						if (!sameBackupBinding(args.context.input.binding, args.event.binding)) return
						enq.sendTo('native', args.event)
						return { context: latch(args) }
					}
				},
				invoke: {
					id: 'native',
					src: 'native',
					input: ({ context }) => context.input,
					onDone: (args) => {
						const { context, event } = args
						if (
							!context.interruption &&
							event.output === 'allowed' &&
							context.input.operation === 'authority' &&
							context.input.step.writeId === heldWriteId
						) {
							return { target: 'holding' }
						}
						return { target: 'complete', context: { result: event.output } }
					},
					onError: { target: 'complete' }
				}
			},
			holding: {
				invoke: {
					src: 'pause',
					onDone: () => {
						return { target: 'complete', context: { result: 'allowed' } }
					},
					onError: { target: 'complete' }
				}
			},
			complete: { type: 'final' }
		}
	})
	const machine = createRestoreMachine(adapter.writer, wire)
	return {
		...adapter,
		machine,
		operation: {
			input: (input: import('xstate').InputFrom<typeof machine>) => input,
			result: (output: import('xstate').OutputFrom<typeof machine>) => output,
			recipient: (actor: import('xstate').ActorRefFrom<typeof machine>) => actor
		},
		commits,
		detached
	}
}
