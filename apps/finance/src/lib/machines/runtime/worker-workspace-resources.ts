import {
	setup,
	types,
	matchesState,
	type ActorRefFrom,
	type SendableEventFromLogic,
	type InputFrom,
	type SnapshotFrom
} from 'xstate'
import type { WorkspaceLease } from 'delightful-local-first/workspace/contracts'
import {
	createFinanceFinancialControlsMachine,
	selectFinanceFinancialReport
} from './worker-financial-controls.js'
import {
	financeQueriesMachine,
	financeQueriesReleaseUnresolved,
	selectFinanceQueryFacts,
	type FinanceContentCapabilities,
	type FinanceContentFacts
} from './worker-queries.js'
import { rejectedTransferMutation } from '../transfers/internal-transfer-mutation-owner.js'

type FinancialLogic = ReturnType<typeof createFinanceFinancialControlsMachine>
type FinancialEvent = SendableEventFromLogic<FinancialLogic>
export type FinanceReadScope = Pick<
	InputFrom<typeof financeQueriesMachine>,
	'selection' | 'transactionId' | 'binding'
>
export type FinanceResourceObservation = {
	forms: InputFrom<FinancialLogic>
	read: FinanceReadScope
}

/** Native payload cleanup selected by the admitting owner; no domain policy lives in DLF. */
export function refuseFinanceFinancialCommand(
	command: Exclude<FinancialEvent, { type: 'SHUTDOWN' }>
) {
	if (command.type === 'START_BACKUP') command.submission.release()
	if (command.type === 'START_WORKSPACE_RESTORE') command.request.release()
	if (command.type === 'TRANSFER_MUTATION_REQUEST')
		command.request.recipient.send({
			type: 'TRANSFER_MUTATION_RESULT',
			requestId: command.request.requestId,
			result: rejectedTransferMutation(command.request)
		})
}

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Finance workspace observation unavailable')
	return value
}
function sameRead(left: FinanceReadScope, right: FinanceReadScope) {
	return (
		left.binding === right.binding &&
		left.selection.workspaceId === right.selection.workspaceId &&
		left.transactionId === right.transactionId
	)
}
function admits(lease: WorkspaceLease, observation: FinanceResourceObservation) {
	return (
		observation.forms.observation.profile.binding === lease.scope.binding &&
		observation.forms.observation.archive.organizationId === lease.request.workspaceId &&
		observation.read.selection.workspaceId === lease.request.workspaceId
	)
}

/** One leased workspace: financial controllers survive replacement of subordinate route reads. */
export function createFinanceWorkspaceResources(options: {
	financial: FinancialLogic
	capabilities: FinanceContentCapabilities
	reportDisposalFailure: () => void
}) {
	type Context = {
		lease: WorkspaceLease
		observation: FinanceResourceObservation | undefined
		read: FinanceReadScope | undefined
		financial: ReturnType<typeof selectFinanceFinancialReport> | undefined
		content: FinanceContentFacts | undefined
		financialReceipt: { outcome: 'closed' } | undefined
		queryReceipt: { outcome: 'released' } | undefined
	}
	const model = setup({
		schemas: {
			input: types<{ lease: WorkspaceLease }>(),
			context: types<Context>(),
			output: types<{ outcome: 'released' }>(),
			events: {
				OBSERVE: types<{ observation: FinanceResourceObservation }>(),
				FINANCIAL: types<{ command: Exclude<FinancialEvent, { type: 'SHUTDOWN' | 'OBSERVE' }> }>(),
				SHUTDOWN: types()
			},
			internalEvents: {
				FINANCIAL_CLOSED: types<{ receipt: { outcome: 'closed' } }>(),
				FINANCIAL_FAILED: types()
			},
			children: {
				financial: types<ActorRefFrom<FinancialLogic>>(),
				queries: types<ActorRefFrom<typeof financeQueriesMachine>>()
			}
		},
		actors: { financial: options.financial, queries: financeQueriesMachine }
	})
	return model.createMachine({
		id: 'finance-workspace-resources',
		initial: 'waiting',
		context: ({ input }) => ({
			...input,
			observation: undefined,
			read: undefined,
			financial: undefined,
			content: undefined,
			financialReceipt: undefined,
			queryReceipt: undefined
		}),
		output: () => ({ outcome: 'released' }),
		on: {
			FINANCIAL: ({ event }, enq) => enq(refuseFinanceFinancialCommand, event.command),
			SHUTDOWN: { target: '.closed' }
		},
		states: {
			waiting: {
				on: {
					OBSERVE: ({ context, event }) =>
						admits(context.lease, event.observation)
							? {
									target: 'attached',
									context: { observation: event.observation, read: event.observation.read }
								}
							: undefined
				}
			},
			attached: {
				initial: 'content',
				invoke: {
					id: 'financial',
					src: 'financial',
					input: ({ context }) => required(context.observation).forms,
					onSnapshot: ({ event }, enq) => {
						if (event.snapshot.status === 'done') return
						const financial = selectFinanceFinancialReport(event.snapshot)
						if (financial.view.status === 'failed') enq.raise({ type: 'FINANCIAL_FAILED' })
						return { context: { financial } }
					},
					onDone: ({ event }, enq) =>
						enq.raise({ type: 'FINANCIAL_CLOSED', receipt: event.output }),
					onError: (_, enq) => enq.raise({ type: 'FINANCIAL_FAILED' })
				},
				states: {
					content: {
						initial: 'active',
						invoke: {
							id: 'queries',
							src: 'queries',
							input: ({ context }) => ({
								...required(context.read),
								ready: { capabilities: options.capabilities },
								reportDisposalFailure: options.reportDisposalFailure
							}),
							onSnapshot: ({ event }) => {
								if (event.snapshot.status === 'done') return
								const content = selectFinanceQueryFacts(event.snapshot)
								return financeQueriesReleaseUnresolved(event.snapshot)
									? { target: '.unresolved', context: { content } }
									: { context: { content } }
							},
							onDone: ({ context, event, value }) => {
								if (matchesState({ attached: { content: 'closing' } }, value))
									return { context: { queryReceipt: event.output } }
								if (matchesState({ attached: { content: 'replacing' } }, value))
									return {
										target: '#finance-workspace-resources.attached.content',
										reenter: true,
										context: {
											read: required(context.observation).read,
											content: undefined,
											queryReceipt: undefined
										}
									}
								return { target: '.unresolved', context: { queryReceipt: event.output } }
							},
							onError: { target: '.unresolved' }
						},
						on: {
							FINANCIAL_FAILED: { target: '.unresolved' },
							FINANCIAL_CLOSED: ({ event, value }) =>
								matchesState({ attached: { content: 'closing' } }, value)
									? { context: { financialReceipt: event.receipt } }
									: { target: '.unresolved', context: { financialReceipt: event.receipt } }
						},
						states: {
							active: {
								on: {
									FINANCIAL: ({ event }, enq) => enq.sendTo('financial', event.command),
									OBSERVE: ({ context, event }, enq) => {
										if (!admits(context.lease, event.observation)) return
										const forms = event.observation.forms
										enq.sendTo('financial', {
											type: 'OBSERVE',
											observation: forms.observation,
											selectionRevision: forms.selectionRevision
										})
										if (forms.initialization !== context.observation?.forms.initialization)
											enq.sendTo('financial', {
												type: 'INITIALIZATION_OBSERVED',
												initialization: forms.initialization
											})
										if (forms.offline !== context.observation?.forms.offline)
											enq.sendTo('financial', { type: 'BANK_NETWORK', offline: forms.offline })
										if (!sameRead(required(context.read), event.observation.read)) {
											enq.sendTo('queries', { type: 'SHUTDOWN' })
											return {
												target: 'replacing',
												context: { observation: event.observation, content: undefined }
											}
										}
										return { context: { observation: event.observation } }
									},
									SHUTDOWN: (_, enq) => {
										enq.sendTo('financial', { type: 'SHUTDOWN' })
										enq.sendTo('queries', { type: 'SHUTDOWN' })
										return { target: 'closing', context: { content: undefined } }
									}
								}
							},
							replacing: {
								on: {
									OBSERVE: ({ context, event }, enq) => {
										if (!admits(context.lease, event.observation)) return
										const forms = event.observation.forms
										enq.sendTo('financial', {
											type: 'OBSERVE',
											observation: forms.observation,
											selectionRevision: forms.selectionRevision
										})
										if (forms.initialization !== context.observation?.forms.initialization)
											enq.sendTo('financial', {
												type: 'INITIALIZATION_OBSERVED',
												initialization: forms.initialization
											})
										if (forms.offline !== context.observation?.forms.offline)
											enq.sendTo('financial', { type: 'BANK_NETWORK', offline: forms.offline })
										return { context: { observation: event.observation } }
									},
									SHUTDOWN: (_, enq) => {
										enq.sendTo('financial', { type: 'SHUTDOWN' })
										return { target: 'closing' }
									}
								}
							},
							closing: {
								always: ({ context }) =>
									context.queryReceipt && context.financialReceipt
										? { target: '#finance-workspace-resources.closed' }
										: undefined,
								on: { SHUTDOWN: {} }
							},
							unresolved: {
								on: {
									SHUTDOWN: {},
									OBSERVE: {},
									FINANCIAL_CLOSED: ({ event }) => ({
										context: { financialReceipt: event.receipt }
									})
								}
							}
						}
					}
				}
			},
			closed: { type: 'final' }
		}
	})
}

export function selectFinanceWorkspaceResources(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkspaceResources>>
) {
	return {
		observation: snapshot.context.observation,
		financial: snapshot.context.financial,
		content: snapshot.context.content,
		failed:
			snapshot.status === 'error' ||
			snapshot.status === 'stopped' ||
			snapshot.matches({ attached: { content: 'unresolved' } })
	}
}
