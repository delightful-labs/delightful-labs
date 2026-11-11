import { required } from './identity.js'
import type { BankHistoryRecord, LastSync, Connection } from './types.js'
import type { SyncAttempt, SyncAccountResult } from '#lib/schema.js'
import type { BankMessage, BankLogPresentation } from '#lib/contracts/bank-presentation-contract.js'
import { m } from '#lib/paraglide/messages.js'
import { bankFailureStatuses } from './status.js'
import { types, setup } from 'xstate'
import type { ActorRef, Snapshot } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type HistoryEvent = {
	type: 'HISTORY_REPORTED'
	revision: number
	connectionId: string | undefined
	summary: LastSync | undefined
}
type Input = {
	revision: number
	recipient: ActorRef<Snapshot<unknown>, HistoryEvent>
}
type Context = Input & {
	records: readonly BankHistoryRecord[]
	connectionId: string | undefined
	summary: LastSync | undefined
}
type Event =
	| { type: 'BINDING_CHANGED'; revision: number }
	| { type: 'CONNECTION_SELECTED'; revision: number; connectionId: string | undefined }
	| { type: 'HISTORY_CHANGED'; revision: number; records: readonly BankHistoryRecord[] }
function selectedHistory(context: Context) {
	return context.records.find((row) => row.id === context.connectionId)
}
type SummaryParams = { outcomeKey: LastSync['outcomeKey'] }
const patchSummarize = (
	{ context }: { context: Context },
	params: SummaryParams
): Partial<Context> => {
	const connection = required(selectedHistory(context))
	return {
		summary: {
			time: required(connection.lastSyncAt),
			outcomeKey: params.outcomeKey,
			imported: connection.importedCount ?? 0,
			existing: connection.existingCount ?? 0,
			omitted: connection.omittedCount ?? 0
		}
	}
}
const events0 = {
	BINDING_CHANGED: types<EventPayload<Event, 'BINDING_CHANGED'>>(),
	CONNECTION_SELECTED: types<EventPayload<Event, 'CONNECTION_SELECTED'>>(),
	HISTORY_CHANGED: types<EventPayload<Event, 'HISTORY_CHANGED'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<never>
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

export const bankHistoryMachine = setup({
	schemas: { context: types<Context>(), events: events0, input: types<Input>() },
	guards: {
		currentRevision: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
			'revision' in event && event.revision === context.revision
	},
	actions: {}
}).createMachine({
	id: 'bank-history',
	tags: ['historical-outcome'],
	context: ({ input }) => ({ ...input, records: [], connectionId: undefined, summary: undefined }),
	initial: 'checkingConnection',
	on: {
		BINDING_CHANGED: (args) => {
			return {
				target: '.checkingConnection',
				context: { revision: args.event.revision, records: [], connectionId: undefined }
			}
		},
		CONNECTION_SELECTED: (args) => {
			if (!args.guards.currentRevision(args)) return
			return { target: '.checkingConnection', context: { connectionId: args.event.connectionId } }
		},
		HISTORY_CHANGED: (args) => {
			if (!args.guards.currentRevision(args)) return
			return { target: '.checkingConnection', context: { records: args.event.records } }
		}
	},
	states: {
		checkingConnection: {
			always: (args) => {
				const { context } = args
				if (!selectedHistory(context)) {
					return { target: 'absent' }
				}
				return { target: 'checkingTime' }
			}
		},
		checkingTime: {
			always: (args) => {
				const { context } = args
				if (!selectedHistory(context)?.lastSyncAt) {
					return { target: 'absent' }
				}
				return { target: 'checkingOutcome' }
			}
		},
		checkingOutcome: {
			always: (args) => {
				const { context } = args
				if (selectedHistory(context)?.lastOutcome === 'succeeded') {
					return { target: 'succeeded' }
				}
				if (selectedHistory(context)?.lastOutcome === 'partial') {
					return { target: 'partial' }
				}
				if (selectedHistory(context)?.lastOutcome === 'failed') {
					return { target: 'failed' }
				}
				return { target: 'absent' }
			}
		},
		absent: {
			entry: (args, enq) => {
				let context = args.context
				let patch = {}
				patch = { ...patch, summary: undefined }
				context = { ...args.context, ...patch }
				{
					const contextBefore = context
					enq.sendTo(contextBefore.recipient, {
						type: 'HISTORY_REPORTED',
						revision: contextBefore.revision,
						connectionId: contextBefore.connectionId,
						summary: contextBefore.summary
					})
				}
				return { context: patch }
			}
		},
		succeeded: {
			entry: (args, enq) => {
				let context = args.context
				let patch = {}
				patch = { ...patch, ...patchSummarize(args, { outcomeKey: 'bank.succeeded' }) }
				context = { ...args.context, ...patch }
				{
					const contextBefore = context
					enq.sendTo(contextBefore.recipient, {
						type: 'HISTORY_REPORTED',
						revision: contextBefore.revision,
						connectionId: contextBefore.connectionId,
						summary: contextBefore.summary
					})
				}
				return { context: patch }
			}
		},
		partial: {
			entry: (args, enq) => {
				let context = args.context
				let patch = {}
				patch = { ...patch, ...patchSummarize(args, { outcomeKey: 'bank.partial' }) }
				context = { ...args.context, ...patch }
				{
					const contextBefore = context
					enq.sendTo(contextBefore.recipient, {
						type: 'HISTORY_REPORTED',
						revision: contextBefore.revision,
						connectionId: contextBefore.connectionId,
						summary: contextBefore.summary
					})
				}
				return { context: patch }
			}
		},
		failed: {
			entry: (args, enq) => {
				let context = args.context
				let patch = {}
				patch = { ...patch, ...patchSummarize(args, { outcomeKey: 'bank.failed' }) }
				context = { ...args.context, ...patch }
				{
					const contextBefore = context
					enq.sendTo(contextBefore.recipient, {
						type: 'HISTORY_REPORTED',
						revision: contextBefore.revision,
						connectionId: contextBefore.connectionId,
						summary: contextBefore.summary
					})
				}
				return { context: patch }
			}
		}
	}
})

const outcomeMessages = {
	unfinished: { label: m['labels.unspecified'] },
	succeeded: { label: m['bank.succeeded'] },
	partial: { label: m['bank.partial'] },
	failed: { label: m['bank.failed'] },
	cancelled: { label: m['status.cancelled'] }
} satisfies Record<SyncAttempt['outcome'], BankMessage>
const connectionMessages = {
	active: outcomeMessages.succeeded,
	error: outcomeMessages.failed,
	revoked: { label: () => m['status.unavailable_subject']({ subject: m['bank.title']() }) }
} satisfies Record<Connection['status'], BankMessage>
const savedMessage = { label: m['status.saved'] }
const settlementMessages = {
	notStarted: { label: m['bank.step_upcoming'] },
	locallyPersisted: savedMessage,
	confirmed: savedMessage,
	unresolved: { label: m['bank.log_unresolved'] }
} satisfies Record<SyncAttempt['importSettlement'], BankMessage>
const failureMessages = {
	...bankFailureStatuses,
	authorization: { label: m['developer.unavailable'] },
	import: {
		label: () => m['errors.save_subject']({ subject: m['nouns.transaction']({ count: 2 }) })
	},
	unexpected: { label: m['errors.unexpected_title'] }
} satisfies Record<NonNullable<SyncAttempt['failureCode']>, BankMessage>

export function selectBankLogPresentation(input: {
	connections: readonly Pick<Connection, 'id' | 'ownerId' | 'claimedAt' | 'status'>[]
	attempts: readonly SyncAttempt[]
	accounts: readonly SyncAccountResult[]
}): BankLogPresentation {
	return {
		connections: input.connections.map((row) => ({
			...row,
			status: connectionMessages[row.status]
		})),
		attempts: input.attempts.map((row) => ({
			...row,
			outcome: outcomeMessages[row.outcome],
			// A successful repeat sync can have no new inserts to settle.
			importSettlement:
				row.importSettlement === 'notStarted' &&
				(row.outcome === 'succeeded' || row.outcome === 'partial')
					? outcomeMessages[row.outcome]
					: settlementMessages[row.importSettlement],
			failure: row.failureCode ? failureMessages[row.failureCode] : undefined
		})),
		accounts: input.accounts.map((row) => ({
			...row,
			outcome: outcomeMessages[row.outcome],
			failure: row.failureCode ? failureMessages[row.failureCode] : undefined
		}))
	}
}
