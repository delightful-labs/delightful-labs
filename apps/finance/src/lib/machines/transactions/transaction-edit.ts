import { m } from '#lib/paraglide/messages.js'
import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import {
	findInternalTransferCounterparts,
	type InternalTransferCandidate
} from '#lib/domain/internal-transfer.js'
import type { InternalTransfer } from '#lib/schema.js'
import type {
	TransactionEntryObservation,
	TransactionEntryScope,
	TransactionEntryView
} from '#lib/contracts/transaction-entry-contract.js'
import type { FormObservation } from '#lib/contracts/form-contract.js'
import type { getDb } from 'jazz-tools/svelte'
import { createScopedFormMachine, selectScopedFormView } from '../forms/scoped-form.js'
import {
	createTransactionEditFormOptions,
	sameTransactionEntryScope,
	transactionEntryScope
} from './transaction-entry.js'
import {
	type InternalTransferLinkInput,
	type InternalTransferLinkResult,
	type InternalTransferUnlinkInput,
	type InternalTransferUnlinkResult,
	type InternalTransferDeleteChoice,
	type InternalTransferDeleteInput,
	type InternalTransferDeleteResult,
	type TransferWriteTracking
} from '../transfers/internal-transfer.js'
import {
	type TransferMutationGateway,
	type TransferMutationRequestInput
} from '../transfers/internal-transfer-mutation-request.js'
import { createTransferMutationRequestMachine } from '../transfers/internal-transfer-mutation-request.js'
import type { TransferMutationResult } from '../transfers/internal-transfer-mutation-owner.js'
import { setup, types, matchesState } from 'xstate'
import type { EventFrom, SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type TransactionEditOptions = ReturnType<typeof createTransactionEditFormOptions>
export type TransactionEditTransferState =
	'unselected' | 'searching' | 'matches' | 'empty' | 'failed' | 'linked' | 'conflicted'
export type TransferStatusLabel = () => string
export type TransferDeleteFeedback = {
	label: () => string
	variant: 'loading' | 'success' | 'error'
}

type TransferObservation = {
	rows: readonly InternalTransferCandidate[]
	scope: TransactionEntryScope
	scopeGeneration: number
	linkedTransactionIds: readonly string[]
	linkedTransfer: InternalTransfer | null
	linked: boolean
	conflicted: boolean
	searchEnabled: boolean
	pendingUnlink: boolean
	loading: boolean
	failed: boolean
}

const observingFormView: TransactionEntryView = {
	readiness: { kind: 'observing' },
	content: { kind: 'fields' },
	activity: { kind: 'idle' },
	feedback: { kind: 'none' },
	canSubmit: false,
	canReset: false,
	canOpen: false,
	canCancel: false,
	fieldsEditable: false,
	canRetryReadiness: false,
	draftRevision: 0
}
const failedFormView: TransactionEntryView = {
	...observingFormView,
	readiness: { kind: 'failed' }
}

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing transaction edit data')
	return value
}

function linkResult(result: TransferMutationResult): InternalTransferLinkResult {
	return result.operation === 'link'
		? result.result
		: { outcome: 'unavailable', settlement: 'unresolved' }
}

function unlinkResult(result: TransferMutationResult): InternalTransferUnlinkResult {
	return result.operation === 'unlink'
		? result.result
		: { outcome: 'unavailable', settlement: 'unresolved' }
}

function deleteResult(result: TransferMutationResult): InternalTransferDeleteResult {
	return result.operation === 'delete'
		? result.result
		: { outcome: 'unavailable', settlement: 'unresolved' }
}

export function createTransactionEditMachine(
	options: TransactionEditOptions,
	db: ReturnType<typeof getDb>,
	trackTransferWrite: (write: TransferWriteTracking) => void,
	mutationGateway: TransferMutationGateway
) {
	const formMachine = createScopedFormMachine(options)
	type FormEvent = import('xstate').SendableEventFromLogic<typeof formMachine>
	type LinkActorInput = InternalTransferLinkInput
	type UnlinkActorInput = InternalTransferUnlinkInput
	type Context = {
		observation: FormObservation<TransactionEntryObservation>
		scopeGeneration: number
		formView: TransactionEntryView
		transferObservation: TransferObservation | undefined
		candidates: readonly InternalTransferCandidate[]
		selectedCandidateId: string | null
		writableCandidateIds: ReadonlySet<string>
		linkedTransfer: InternalTransfer | null
		unlinkWritable: boolean
		linkInput: LinkActorInput | undefined
		linkResult: InternalTransferLinkResult | null
		unlinkInput: UnlinkActorInput | undefined
		unlinkResult: InternalTransferUnlinkResult | null
		deleteInput: InternalTransferDeleteInput | undefined
		deleteResult: InternalTransferDeleteResult | null
	}
	type Event =
		| { type: 'OBSERVE'; observation: TransactionEntryObservation }
		| { type: 'FORM'; event: FormEvent }
		| { type: 'ENABLE_SEARCH' }
		| { type: 'DISABLE_SEARCH' }
		| { type: 'TRANSFER_OBSERVATION'; observation: TransferObservation }
		| { type: 'SELECT_COUNTERPART'; candidateId: string }
		| { type: 'LINK_COUNTERPART'; candidateId: string }
		| { type: 'UNLINK_TRANSFER' }
		| { type: 'DELETE_LINKED_TRANSFER'; choice: InternalTransferDeleteChoice }
		| { type: 'SCOPE_CHANGED' }
		| { type: 'LINK_SUCCEEDED' }
		| { type: 'UNLINK_SUCCEEDED' }
		| { type: 'SHUTDOWN' }
	const mutationRequest = createTransferMutationRequestMachine(mutationGateway)
	const actors = {
		form: formMachine,
		linkOperation: mutationRequest,
		unlinkOperation: mutationRequest,
		deleteOperation: mutationRequest
	}
	const events0 = {
		OBSERVE: types<EventPayload<Event, 'OBSERVE'>>(),
		FORM: types<EventPayload<Event, 'FORM'>>(),
		ENABLE_SEARCH: types<EventPayload<Event, 'ENABLE_SEARCH'>>(),
		DISABLE_SEARCH: types<EventPayload<Event, 'DISABLE_SEARCH'>>(),
		TRANSFER_OBSERVATION: types<EventPayload<Event, 'TRANSFER_OBSERVATION'>>(),
		SELECT_COUNTERPART: types<EventPayload<Event, 'SELECT_COUNTERPART'>>(),
		LINK_COUNTERPART: types<EventPayload<Event, 'LINK_COUNTERPART'>>(),
		UNLINK_TRANSFER: types<EventPayload<Event, 'UNLINK_TRANSFER'>>(),
		DELETE_LINKED_TRANSFER: types<EventPayload<Event, 'DELETE_LINKED_TRANSFER'>>(),
		SCOPE_CHANGED: types<EventPayload<Event, 'SCOPE_CHANGED'>>(),
		LINK_SUCCEEDED: types<EventPayload<Event, 'LINK_SUCCEEDED'>>(),
		UNLINK_SUCCEEDED: types<EventPayload<Event, 'UNLINK_SUCCEEDED'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['form']>
				| import('xstate').OutputFrom<(typeof actors)['linkOperation']>
				| import('xstate').OutputFrom<(typeof actors)['unlinkOperation']>
				| import('xstate').OutputFrom<(typeof actors)['deleteOperation']>
				| import('xstate').OutputFrom<(typeof actors)['form']>
		  >
		| import('xstate').ErrorActorEvent
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<TransactionEntryObservation>(),
			children: {
				form: types<import('xstate').ActorRefFrom<(typeof actors)['form']>>(),
				linkOperation: types<import('xstate').ActorRefFrom<(typeof actors)['linkOperation']>>(),
				unlinkOperation: types<import('xstate').ActorRefFrom<(typeof actors)['unlinkOperation']>>(),
				deleteOperation: types<import('xstate').ActorRefFrom<(typeof actors)['deleteOperation']>>(),
				scopedForm: types<import('xstate').ActorRefFrom<(typeof actors)['form']>>()
			},
			meta: types<{
				transferStatus?: TransferStatusLabel
				priority?: number
				deleteFeedback?: TransferDeleteFeedback
			}>()
		},
		actors,
		guards: {
			conflictedObservation: ({ event }: { event: NativeEvent0 }) =>
				event.type === 'TRANSFER_OBSERVATION' && event.observation.conflicted,
			linkedObservation: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'TRANSFER_OBSERVATION' && event.observation.linked,
			searchDisabledObservation: ({ event }: { event: NativeEvent0 }) =>
				event.type === 'TRANSFER_OBSERVATION' && !event.observation.searchEnabled,
			searchLoading: ({ event }: { event: NativeEvent0 }) =>
				event.type === 'TRANSFER_OBSERVATION' && event.observation.loading,
			searchFailed: ({ event }: { event: NativeEvent0 }) =>
				event.type === 'TRANSFER_OBSERVATION' && event.observation.failed,
			currentTransferObservation: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'TRANSFER_OBSERVATION' &&
				sameTransactionEntryScope(
					transactionEntryScope(context.observation.facts),
					event.observation.scope
				) &&
				context.scopeGeneration === event.observation.scopeGeneration,
			workflowActive: (args: { value: import('xstate').StateValue }) =>
				matchesState({ running: { lifecycle: 'active' } }, args.value),
			transferSearchActive: (args: { value: import('xstate').StateValue }) =>
				matchesState({ running: { transfer: 'searching' } }, args.value) ||
				matchesState({ running: { transfer: 'matches' } }, args.value) ||
				matchesState({ running: { transfer: 'empty' } }, args.value) ||
				matchesState({ running: { transfer: 'failed' } }, args.value),
			canDisableSearch: ({ context }: { context: Context }) =>
				context.linkInput === undefined &&
				context.unlinkInput === undefined &&
				context.deleteInput === undefined,
			canForwardForm: ({ context }: { context: Context }) =>
				context.linkInput === undefined &&
				context.unlinkInput === undefined &&
				context.deleteInput === undefined,
			formSubmit: ({ event }: { event: NativeEvent0 }) =>
				event.type === 'FORM' && event.event.type === 'SUBMIT',
			hasCandidates: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'TRANSFER_OBSERVATION' &&
				transferCandidates(context.observation.facts, event.observation).length > 0,
			canLink: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'LINK_COUNTERPART' &&
				context.selectedCandidateId === event.candidateId &&
				context.candidates.some(({ id }) => id === event.candidateId) &&
				context.writableCandidateIds.has(event.candidateId) &&
				context.formView.fieldsEditable &&
				Boolean(context.observation.facts.identityId) &&
				Boolean(context.observation.facts.organizationId) &&
				Boolean(context.observation.facts.binding) &&
				!context.observation.facts.transaction?.internalTransferId,
			canUnlink: ({ context }: { context: Context }) =>
				Boolean(
					context.linkedTransfer &&
					context.unlinkWritable &&
					context.formView.fieldsEditable &&
					(context.observation.facts.transaction?.internalTransferId ===
						context.linkedTransfer.id ||
						context.transferObservation?.pendingUnlink) &&
					context.observation.facts.identityId &&
					context.observation.facts.organizationId &&
					context.observation.facts.binding
				),
			canDelete: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'DELETE_LINKED_TRANSFER' &&
				Boolean(
					context.linkedTransfer &&
					context.formView.fieldsEditable &&
					context.observation.facts.transaction &&
					(context.observation.facts.transaction.id ===
						context.linkedTransfer.expenseTransactionId ||
						context.observation.facts.transaction.id ===
							context.linkedTransfer.incomeTransactionId) &&
					(event.choice.kind === 'both' ||
						event.choice.transactionId === context.observation.facts.transaction.id) &&
					context.observation.facts.identityId &&
					context.observation.facts.organizationId &&
					context.observation.facts.binding &&
					context.deleteInput === undefined &&
					context.linkInput === undefined &&
					context.unlinkInput === undefined
				),
			selectCounterpart: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'SELECT_COUNTERPART' &&
				context.candidates.some(({ id }) => id === event.candidateId) &&
				context.linkInput === undefined &&
				context.unlinkInput === undefined &&
				context.deleteInput === undefined,
			transferMatches: (args: { value: import('xstate').StateValue }) =>
				matchesState({ running: { transfer: 'matches' } }, args.value),
			transferLinked: (args: { value: import('xstate').StateValue }) =>
				matchesState({ running: { transfer: 'linked' } }, args.value)
		}
	})
	const logic = workflow.createMachine({
		id: 'transaction-edit-form',
		context: ({ input }) => ({
			observation: { revision: 0, facts: input },
			scopeGeneration: 0,
			formView: observingFormView,
			transferObservation: undefined,
			candidates: [],
			selectedCandidateId: null,
			writableCandidateIds: new Set<string>(),
			linkedTransfer: null,
			unlinkWritable: false,
			linkInput: undefined,
			linkResult: null,
			unlinkInput: undefined,
			unlinkResult: null,
			deleteInput: undefined,
			deleteResult: null
		}),
		initial: 'running',
		states: {
			closed: { type: 'final' },
			running: {
				type: 'parallel',
				onDone: { target: '#transaction-edit-form.closed' },
				on: {
					OBSERVE: (args, enq) => {
						let context = args.context
						if (!args.guards.workflowActive(args)) return
						const { event } = args
						let patch = {}
						{
							const contextBefore = args.context
							if (event.type !== 'OBSERVE') {
							} else {
								const changed = !sameTransactionEntryScope(
									transactionEntryScope(contextBefore.observation.facts),
									transactionEntryScope(event.observation)
								)
								patch = {
									...patch,
									...(({ context }) => {
										const transferObservation = changed ? undefined : context.transferObservation
										const candidates = transferObservation
											? transferCandidates(event.observation, transferObservation)
											: []
										return {
											observation: {
												revision: context.observation.revision + 1,
												facts: event.observation
											},
											scopeGeneration: context.scopeGeneration + (changed ? 1 : 0),
											transferObservation,
											candidates,
											selectedCandidateId: candidates.some(
												({ id }) => id === context.selectedCandidateId
											)
												? context.selectedCandidateId
												: (candidates[0]?.id ?? null),
											writableCandidateIds: writableCandidates(event.observation, candidates),
											linkedTransfer: transferObservation?.linkedTransfer ?? null,
											unlinkWritable: writableLinkedTransfer(
												event.observation,
												transferObservation?.linkedTransfer ?? null
											),
											...(changed
												? { linkResult: null, unlinkResult: null, deleteResult: null }
												: {})
										}
									})({ ...args, context })
								}
								context = { ...args.context, ...patch }
								enq.sendTo('scopedForm', { type: 'OBSERVE', observation: event.observation })
								if (changed) enq.raise({ type: 'SCOPE_CHANGED' })
							}
						}
						return { context: patch }
					},
					SELECT_COUNTERPART: (args) => {
						if (!(
							matchesState({ running: { lifecycle: 'active' } }, args.value) &&
							(matchesState({ running: { transfer: 'searching' } }, args.value) ||
								matchesState({ running: { transfer: 'matches' } }, args.value) ||
								matchesState({ running: { transfer: 'empty' } }, args.value) ||
								matchesState({ running: { transfer: 'failed' } }, args.value)) &&
							args.guards.selectCounterpart(args)
						))
							return
						return { context: { selectedCandidateId: args.event.candidateId } }
					},
					FORM: (args, enq) => {
						const { event } = args
						if (
							matchesState({ running: { lifecycle: 'active' } }, args.value) &&
							args.guards.formSubmit(args) &&
							args.guards.canForwardForm(args)
						) {
							if (event.type === 'FORM') enq.sendTo('scopedForm', event.event)
							return {}
						}
						if (
							matchesState({ running: { lifecycle: 'active' } }, args.value) &&
							args.guards.formSubmit(args)
						) {
							return {}
						}
						if (
							matchesState({ running: { lifecycle: 'active' } }, args.value) &&
							args.guards.canForwardForm(args)
						) {
							if (event.type === 'FORM') enq.sendTo('scopedForm', event.event)
							return {}
						}
					}
				},
				states: {
					lifecycle: {
						initial: 'active',
						states: {
							active: { on: { SHUTDOWN: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					form: {
						initial: 'attached',
						states: {
							attached: {
								invoke: {
									id: 'scopedForm',
									src: 'form',
									input: ({ context }) => context.observation.facts,
									onSnapshot: (args) => {
										return {
											context: { formView: selectScopedFormView(args.event.snapshot, options) }
										}
									},
									onDone: { target: 'formClosed' },
									onError: () => {
										return { target: 'formClosed', context: { formView: failedFormView } }
									}
								},
								on: {
									SHUTDOWN: (args, enq) => {
										{
											const child = args.children.scopedForm
											if (child?.getSnapshot().status === 'active')
												enq.sendTo(child, { type: 'SHUTDOWN' })
										}
									}
								}
							},
							formClosed: { type: 'final' }
						}
					},
					transfer: {
						initial: 'unselected',
						on: {
							SHUTDOWN: { target: '.transferClosed' },
							SCOPE_CHANGED: (args) => {
								return {
									target: '.unselected',
									context: ((args) => ({
										transferObservation: undefined,
										candidates: [],
										selectedCandidateId: null,
										writableCandidateIds: new Set<string>(),
										linkedTransfer: null,
										unlinkWritable: false,
										linkResult: null,
										unlinkResult: null,
										deleteInput: undefined,
										deleteResult: null
									}))(args)
								}
							},
							TRANSFER_OBSERVATION: (args) => {
								if (
									args.guards.currentTransferObservation(args) &&
									args.guards.conflictedObservation(args)
								) {
									return {
										target: '.conflicted',
										context: (({ context, event }) => {
											if (event.type !== 'TRANSFER_OBSERVATION') return {}
											const candidates = transferCandidates(
												context.observation.facts,
												event.observation
											)
											return {
												transferObservation: event.observation,
												candidates,
												selectedCandidateId: candidates.some(
													({ id }) => id === context.selectedCandidateId
												)
													? context.selectedCandidateId
													: (candidates[0]?.id ?? null),
												linkedTransfer: event.observation.linkedTransfer,
												unlinkResult: event.observation.pendingUnlink
													? {
															outcome: 'recoveryRequired',
															transferId: required(event.observation.linkedTransfer?.id),
															settlement: 'locallyPersisted'
														}
													: !event.observation.linked &&
														  context.unlinkResult?.outcome === 'recoveryRequired'
														? null
														: event.observation.linked &&
															  context.unlinkResult?.outcome === 'succeeded'
															? null
															: context.unlinkResult,
												writableCandidateIds: writableCandidates(
													context.observation.facts,
													candidates
												),
												unlinkWritable: writableLinkedTransfer(
													context.observation.facts,
													event.observation.linkedTransfer
												)
											}
										})(args)
									}
								}
								if (
									args.guards.currentTransferObservation(args) &&
									args.guards.linkedObservation(args)
								) {
									return {
										target: '.linked',
										context: (({ context, event }) => {
											if (event.type !== 'TRANSFER_OBSERVATION') return {}
											const candidates = transferCandidates(
												context.observation.facts,
												event.observation
											)
											return {
												transferObservation: event.observation,
												candidates,
												selectedCandidateId: candidates.some(
													({ id }) => id === context.selectedCandidateId
												)
													? context.selectedCandidateId
													: (candidates[0]?.id ?? null),
												linkedTransfer: event.observation.linkedTransfer,
												unlinkResult: event.observation.pendingUnlink
													? {
															outcome: 'recoveryRequired',
															transferId: required(event.observation.linkedTransfer?.id),
															settlement: 'locallyPersisted'
														}
													: !event.observation.linked &&
														  context.unlinkResult?.outcome === 'recoveryRequired'
														? null
														: event.observation.linked &&
															  context.unlinkResult?.outcome === 'succeeded'
															? null
															: context.unlinkResult,
												writableCandidateIds: writableCandidates(
													context.observation.facts,
													candidates
												),
												unlinkWritable: writableLinkedTransfer(
													context.observation.facts,
													event.observation.linkedTransfer
												)
											}
										})(args)
									}
								}
								if (
									args.guards.currentTransferObservation(args) &&
									args.guards.transferSearchActive(args) &&
									args.guards.searchLoading(args)
								) {
									return {
										target: '.searching',
										context: (({ context, event }) => {
											if (event.type !== 'TRANSFER_OBSERVATION') return {}
											const candidates = transferCandidates(
												context.observation.facts,
												event.observation
											)
											return {
												transferObservation: event.observation,
												candidates,
												selectedCandidateId: candidates.some(
													({ id }) => id === context.selectedCandidateId
												)
													? context.selectedCandidateId
													: (candidates[0]?.id ?? null),
												linkedTransfer: event.observation.linkedTransfer,
												unlinkResult: event.observation.pendingUnlink
													? {
															outcome: 'recoveryRequired',
															transferId: required(event.observation.linkedTransfer?.id),
															settlement: 'locallyPersisted'
														}
													: !event.observation.linked &&
														  context.unlinkResult?.outcome === 'recoveryRequired'
														? null
														: event.observation.linked &&
															  context.unlinkResult?.outcome === 'succeeded'
															? null
															: context.unlinkResult,
												writableCandidateIds: writableCandidates(
													context.observation.facts,
													candidates
												),
												unlinkWritable: writableLinkedTransfer(
													context.observation.facts,
													event.observation.linkedTransfer
												)
											}
										})(args)
									}
								}
								if (
									args.guards.currentTransferObservation(args) &&
									args.guards.transferSearchActive(args) &&
									args.guards.searchFailed(args)
								) {
									return {
										target: '.failed',
										context: (({ context, event }) => {
											if (event.type !== 'TRANSFER_OBSERVATION') return {}
											const candidates = transferCandidates(
												context.observation.facts,
												event.observation
											)
											return {
												transferObservation: event.observation,
												candidates,
												selectedCandidateId: candidates.some(
													({ id }) => id === context.selectedCandidateId
												)
													? context.selectedCandidateId
													: (candidates[0]?.id ?? null),
												linkedTransfer: event.observation.linkedTransfer,
												unlinkResult: event.observation.pendingUnlink
													? {
															outcome: 'recoveryRequired',
															transferId: required(event.observation.linkedTransfer?.id),
															settlement: 'locallyPersisted'
														}
													: !event.observation.linked &&
														  context.unlinkResult?.outcome === 'recoveryRequired'
														? null
														: event.observation.linked &&
															  context.unlinkResult?.outcome === 'succeeded'
															? null
															: context.unlinkResult,
												writableCandidateIds: writableCandidates(
													context.observation.facts,
													candidates
												),
												unlinkWritable: writableLinkedTransfer(
													context.observation.facts,
													event.observation.linkedTransfer
												)
											}
										})(args)
									}
								}
								if (
									args.guards.currentTransferObservation(args) &&
									args.guards.transferSearchActive(args) &&
									args.guards.hasCandidates(args)
								) {
									return {
										target: '.matches',
										context: (({ context, event }) => {
											if (event.type !== 'TRANSFER_OBSERVATION') return {}
											const candidates = transferCandidates(
												context.observation.facts,
												event.observation
											)
											return {
												transferObservation: event.observation,
												candidates,
												selectedCandidateId: candidates.some(
													({ id }) => id === context.selectedCandidateId
												)
													? context.selectedCandidateId
													: (candidates[0]?.id ?? null),
												linkedTransfer: event.observation.linkedTransfer,
												unlinkResult: event.observation.pendingUnlink
													? {
															outcome: 'recoveryRequired',
															transferId: required(event.observation.linkedTransfer?.id),
															settlement: 'locallyPersisted'
														}
													: !event.observation.linked &&
														  context.unlinkResult?.outcome === 'recoveryRequired'
														? null
														: event.observation.linked &&
															  context.unlinkResult?.outcome === 'succeeded'
															? null
															: context.unlinkResult,
												writableCandidateIds: writableCandidates(
													context.observation.facts,
													candidates
												),
												unlinkWritable: writableLinkedTransfer(
													context.observation.facts,
													event.observation.linkedTransfer
												)
											}
										})(args)
									}
								}
								if (
									args.guards.currentTransferObservation(args) &&
									args.guards.transferSearchActive(args)
								) {
									return {
										target: '.empty',
										context: (({ context, event }) => {
											if (event.type !== 'TRANSFER_OBSERVATION') return {}
											const candidates = transferCandidates(
												context.observation.facts,
												event.observation
											)
											return {
												transferObservation: event.observation,
												candidates,
												selectedCandidateId: candidates.some(
													({ id }) => id === context.selectedCandidateId
												)
													? context.selectedCandidateId
													: (candidates[0]?.id ?? null),
												linkedTransfer: event.observation.linkedTransfer,
												unlinkResult: event.observation.pendingUnlink
													? {
															outcome: 'recoveryRequired',
															transferId: required(event.observation.linkedTransfer?.id),
															settlement: 'locallyPersisted'
														}
													: !event.observation.linked &&
														  context.unlinkResult?.outcome === 'recoveryRequired'
														? null
														: event.observation.linked &&
															  context.unlinkResult?.outcome === 'succeeded'
															? null
															: context.unlinkResult,
												writableCandidateIds: writableCandidates(
													context.observation.facts,
													candidates
												),
												unlinkWritable: writableLinkedTransfer(
													context.observation.facts,
													event.observation.linkedTransfer
												)
											}
										})(args)
									}
								}
								if (
									args.guards.currentTransferObservation(args) &&
									args.guards.searchDisabledObservation(args)
								) {
									return {
										target: '.unselected',
										context: (({ context, event }) => {
											if (event.type !== 'TRANSFER_OBSERVATION') return {}
											const candidates = transferCandidates(
												context.observation.facts,
												event.observation
											)
											return {
												transferObservation: event.observation,
												candidates,
												selectedCandidateId: candidates.some(
													({ id }) => id === context.selectedCandidateId
												)
													? context.selectedCandidateId
													: (candidates[0]?.id ?? null),
												linkedTransfer: event.observation.linkedTransfer,
												unlinkResult: event.observation.pendingUnlink
													? {
															outcome: 'recoveryRequired',
															transferId: required(event.observation.linkedTransfer?.id),
															settlement: 'locallyPersisted'
														}
													: !event.observation.linked &&
														  context.unlinkResult?.outcome === 'recoveryRequired'
														? null
														: event.observation.linked &&
															  context.unlinkResult?.outcome === 'succeeded'
															? null
															: context.unlinkResult,
												writableCandidateIds: writableCandidates(
													context.observation.facts,
													candidates
												),
												unlinkWritable: writableLinkedTransfer(
													context.observation.facts,
													event.observation.linkedTransfer
												)
											}
										})(args)
									}
								}
							},
							LINK_SUCCEEDED: { target: '.linked' },
							UNLINK_SUCCEEDED: { target: '.matches' }
						},
						states: {
							unselected: { on: { ENABLE_SEARCH: { target: 'searching' } } },
							conflicted: {},
							searching: {
								meta: {
									transferStatus: () =>
										m['status.loading_subject']({ subject: m['nouns.transaction']({ count: 2 }) }),
									priority: 3
								},
								on: {
									DISABLE_SEARCH: (args) => {
										if (!args.guards.canDisableSearch(args)) return
										return { target: 'unselected' }
									}
								}
							},
							matches: {
								on: {
									DISABLE_SEARCH: (args) => {
										if (!args.guards.canDisableSearch(args)) return
										return { target: 'unselected' }
									}
								}
							},
							empty: {
								on: {
									DISABLE_SEARCH: (args) => {
										if (!args.guards.canDisableSearch(args)) return
										return { target: 'unselected' }
									}
								}
							},
							failed: {
								meta: {
									transferStatus: () =>
										m['errors.load_subject']({ subject: m['nouns.transaction']({ count: 2 }) }),
									priority: 3
								},
								on: {
									DISABLE_SEARCH: (args) => {
										if (!args.guards.canDisableSearch(args)) return
										return { target: 'unselected' }
									}
								}
							},
							linked: {},
							transferClosed: { type: 'final' }
						}
					},
					link: {
						initial: 'idle',
						states: {
							idle: {
								on: {
									LINK_COUNTERPART: (args) => {
										if (!(args.guards.canLink(args) && args.guards.transferMatches(args))) return
										return {
											target: 'operating.active',
											context: (({ context, event }) => {
												if (event.type !== 'LINK_COUNTERPART') return {}
												const source = context.observation.facts.transaction
												const candidate = context.candidates.find(
													({ id }) => id === context.selectedCandidateId
												)
												const identityId = context.observation.facts.identityId
												const organizationId = context.observation.facts.organizationId
												if (!source || !candidate || !identityId || !organizationId) return {}
												return {
													linkInput: {
														db,
														identityId,
														organizationId,
														expenseTransactionId:
															source.kind === 'expense' ? source.id : candidate.id,
														incomeTransactionId:
															source.kind === 'income' ? source.id : candidate.id,
														trackWrite: trackTransferWrite
													},
													linkResult: null
												}
											})(args)
										}
									},
									SCOPE_CHANGED: (args) => {
										return {
											context: ((args) => ({
												transferObservation: undefined,
												candidates: [],
												selectedCandidateId: null,
												writableCandidateIds: new Set<string>(),
												linkedTransfer: null,
												unlinkWritable: false,
												linkResult: null,
												unlinkResult: null,
												deleteInput: undefined,
												deleteResult: null
											}))(args)
										}
									},
									SHUTDOWN: { target: 'linkClosed' }
								}
							},
							operating: {
								meta: { transferStatus: () => m['forms.settling'](), priority: 1 },
								initial: 'active',
								invoke: {
									id: 'linkOperation',
									src: 'linkOperation',
									input: ({
										context
									}): Extract<TransferMutationRequestInput, { operation: 'link' }> => ({
										workspaceId: required(context.linkInput).organizationId,
										operation: 'link',
										input: required(context.linkInput)
									}),
									onDone: (args, enq) => {
										const { event } = args
										if (matchesState({ running: { link: { operating: 'closing' } } }, args.value)) {
											return { target: '#transaction-edit-form.running.link.linkClosed' }
										}
										if (
											matchesState({ running: { link: { operating: 'replacing' } } }, args.value)
										) {
											return {
												target: '#transaction-edit-form.running.link.idle',
												context: { linkInput: undefined, linkResult: null }
											}
										}
										if (
											event.output.operation === 'link' &&
											event.output.result.outcome === 'succeeded'
										) {
											enq.raise({ type: 'LINK_SUCCEEDED' })
											return {
												target: '#transaction-edit-form.running.link.succeeded',
												context: { linkResult: linkResult(event.output), linkInput: undefined }
											}
										}
										return {
											target: '#transaction-edit-form.running.link.rejected',
											context: { linkResult: linkResult(event.output), linkInput: undefined }
										}
									},
									onError: (args) => {
										if (matchesState({ running: { link: { operating: 'closing' } } }, args.value)) {
											return { target: '#transaction-edit-form.running.link.linkClosed' }
										}
										if (
											matchesState({ running: { link: { operating: 'replacing' } } }, args.value)
										) {
											return {
												target: '#transaction-edit-form.running.link.idle',
												context: { linkInput: undefined, linkResult: null }
											}
										}
										return {
											target: '#transaction-edit-form.running.link.rejected',
											context: {
												linkResult: {
													outcome: 'unavailable',
													settlement: 'unresolved',
													error: args.event.error
												},
												linkInput: undefined
											}
										}
									}
								},
								states: {
									active: {
										on: {
											SCOPE_CHANGED: (args, enq) => {
												{
													const child = args.children.linkOperation
													if (child?.getSnapshot().status === 'active')
														enq.sendTo(child, { type: 'SHUTDOWN' })
												}
												return { target: 'replacing' }
											},
											SHUTDOWN: (args, enq) => {
												{
													const child = args.children.linkOperation
													if (child?.getSnapshot().status === 'active')
														enq.sendTo(child, { type: 'SHUTDOWN' })
												}
												return { target: 'closing' }
											}
										}
									},
									closing: {},
									replacing: {
										on: {
											SHUTDOWN: (args, enq) => {
												{
													const child = args.children.linkOperation
													if (child?.getSnapshot().status === 'active')
														enq.sendTo(child, { type: 'SHUTDOWN' })
												}
												return { target: 'closing' }
											}
										}
									}
								}
							},
							succeeded: {
								meta: {
									transferStatus: () =>
										m['status.saved_subject']({ subject: m['nouns.transfer']({ count: 1 }) }),
									priority: 1
								},
								on: {
									LINK_COUNTERPART: (args) => {
										if (!(args.guards.canLink(args) && args.guards.transferMatches(args))) return
										return {
											target: 'operating.active',
											context: (({ context, event }) => {
												if (event.type !== 'LINK_COUNTERPART') return {}
												const source = context.observation.facts.transaction
												const candidate = context.candidates.find(
													({ id }) => id === context.selectedCandidateId
												)
												const identityId = context.observation.facts.identityId
												const organizationId = context.observation.facts.organizationId
												if (!source || !candidate || !identityId || !organizationId) return {}
												return {
													linkInput: {
														db,
														identityId,
														organizationId,
														expenseTransactionId:
															source.kind === 'expense' ? source.id : candidate.id,
														incomeTransactionId:
															source.kind === 'income' ? source.id : candidate.id,
														trackWrite: trackTransferWrite
													},
													linkResult: null
												}
											})(args)
										}
									},
									SCOPE_CHANGED: (args) => {
										return {
											target: 'idle',
											context: ((args) => ({
												transferObservation: undefined,
												candidates: [],
												selectedCandidateId: null,
												writableCandidateIds: new Set<string>(),
												linkedTransfer: null,
												unlinkWritable: false,
												linkResult: null,
												unlinkResult: null,
												deleteInput: undefined,
												deleteResult: null
											}))(args)
										}
									},
									SHUTDOWN: { target: 'linkClosed' }
								}
							},
							rejected: {
								initial: 'classifying',
								states: {
									classifying: {
										always: (args) => {
											const { context } = args
											if (
												context.linkResult?.outcome === 'cancelled' ||
												context.linkResult?.outcome === 'closed'
											) {
												return { target: 'cancelled' }
											}
											return { target: 'failed' }
										}
									},
									cancelled: {
										meta: { transferStatus: () => m['status.cancelled'](), priority: 1 }
									},
									failed: {
										meta: {
											transferStatus: () =>
												m['errors.save_subject']({ subject: m['nouns.transfer']({ count: 1 }) }),
											priority: 1
										}
									}
								},
								on: {
									LINK_COUNTERPART: (args) => {
										if (!(args.guards.canLink(args) && args.guards.transferMatches(args))) return
										return {
											target: 'operating.active',
											context: (({ context, event }) => {
												if (event.type !== 'LINK_COUNTERPART') return {}
												const source = context.observation.facts.transaction
												const candidate = context.candidates.find(
													({ id }) => id === context.selectedCandidateId
												)
												const identityId = context.observation.facts.identityId
												const organizationId = context.observation.facts.organizationId
												if (!source || !candidate || !identityId || !organizationId) return {}
												return {
													linkInput: {
														db,
														identityId,
														organizationId,
														expenseTransactionId:
															source.kind === 'expense' ? source.id : candidate.id,
														incomeTransactionId:
															source.kind === 'income' ? source.id : candidate.id,
														trackWrite: trackTransferWrite
													},
													linkResult: null
												}
											})(args)
										}
									},
									SCOPE_CHANGED: (args) => {
										return {
											target: 'idle',
											context: ((args) => ({
												transferObservation: undefined,
												candidates: [],
												selectedCandidateId: null,
												writableCandidateIds: new Set<string>(),
												linkedTransfer: null,
												unlinkWritable: false,
												linkResult: null,
												unlinkResult: null,
												deleteInput: undefined,
												deleteResult: null
											}))(args)
										}
									},
									SHUTDOWN: { target: 'linkClosed' }
								}
							},
							linkClosed: { type: 'final' }
						}
					},
					unlink: {
						initial: 'idle',
						states: {
							idle: {
								on: {
									UNLINK_TRANSFER: (args) => {
										if (!(args.guards.canUnlink(args) && args.guards.transferLinked(args))) return
										return {
											target: 'operating.active',
											context: (({ context, event }) => {
												if (event.type !== 'UNLINK_TRANSFER' || !context.linkedTransfer) return {}
												const identityId = context.observation.facts.identityId
												const organizationId = context.observation.facts.organizationId
												if (!identityId || !organizationId) return {}
												return {
													unlinkInput: {
														db,
														identityId,
														organizationId,
														transferId: context.linkedTransfer.id,
														expenseTransactionId: context.linkedTransfer.expenseTransactionId,
														incomeTransactionId: context.linkedTransfer.incomeTransactionId,
														trackWrite: trackTransferWrite
													},
													unlinkResult: null
												}
											})(args)
										}
									},
									SCOPE_CHANGED: (args) => {
										return {
											context: ((args) => ({
												transferObservation: undefined,
												candidates: [],
												selectedCandidateId: null,
												writableCandidateIds: new Set<string>(),
												linkedTransfer: null,
												unlinkWritable: false,
												linkResult: null,
												unlinkResult: null,
												deleteInput: undefined,
												deleteResult: null
											}))(args)
										}
									},
									SHUTDOWN: { target: 'unlinkClosed' }
								}
							},
							operating: {
								meta: { transferStatus: () => m['forms.settling'](), priority: 2 },
								initial: 'active',
								invoke: {
									id: 'unlinkOperation',
									src: 'unlinkOperation',
									input: ({
										context
									}): Extract<TransferMutationRequestInput, { operation: 'unlink' }> => ({
										workspaceId: required(context.unlinkInput).organizationId,
										operation: 'unlink',
										input: required(context.unlinkInput)
									}),
									onDone: (args, enq) => {
										const { event } = args
										if (
											matchesState({ running: { unlink: { operating: 'closing' } } }, args.value)
										) {
											return { target: '#transaction-edit-form.running.unlink.unlinkClosed' }
										}
										if (
											matchesState({ running: { unlink: { operating: 'replacing' } } }, args.value)
										) {
											return {
												target: '#transaction-edit-form.running.unlink.idle',
												context: { unlinkInput: undefined, unlinkResult: null }
											}
										}
										if (
											event.output.operation === 'unlink' &&
											event.output.result.outcome === 'succeeded'
										) {
											enq.raise({ type: 'UNLINK_SUCCEEDED' })
											return {
												target: '#transaction-edit-form.running.unlink.succeeded',
												context: {
													unlinkResult: unlinkResult(event.output),
													unlinkInput: undefined
												}
											}
										}
										return {
											target: '#transaction-edit-form.running.unlink.rejected',
											context: { unlinkResult: unlinkResult(event.output), unlinkInput: undefined }
										}
									},
									onError: (args) => {
										if (
											matchesState({ running: { unlink: { operating: 'closing' } } }, args.value)
										) {
											return { target: '#transaction-edit-form.running.unlink.unlinkClosed' }
										}
										if (
											matchesState({ running: { unlink: { operating: 'replacing' } } }, args.value)
										) {
											return {
												target: '#transaction-edit-form.running.unlink.idle',
												context: { unlinkInput: undefined, unlinkResult: null }
											}
										}
										return {
											target: '#transaction-edit-form.running.unlink.rejected',
											context: {
												unlinkResult: {
													outcome: 'unavailable',
													settlement: 'unresolved',
													error: args.event.error
												},
												unlinkInput: undefined
											}
										}
									}
								},
								states: {
									active: {
										on: {
											SCOPE_CHANGED: (args, enq) => {
												{
													const child = args.children.unlinkOperation
													if (child?.getSnapshot().status === 'active')
														enq.sendTo(child, { type: 'SHUTDOWN' })
												}
												return { target: 'replacing' }
											},
											SHUTDOWN: (args, enq) => {
												{
													const child = args.children.unlinkOperation
													if (child?.getSnapshot().status === 'active')
														enq.sendTo(child, { type: 'SHUTDOWN' })
												}
												return { target: 'closing' }
											}
										}
									},
									closing: {},
									replacing: {
										on: {
											SHUTDOWN: (args, enq) => {
												{
													const child = args.children.unlinkOperation
													if (child?.getSnapshot().status === 'active')
														enq.sendTo(child, { type: 'SHUTDOWN' })
												}
												return { target: 'closing' }
											}
										}
									}
								}
							},
							succeeded: {
								meta: {
									transferStatus: () =>
										m['status.saved_subject']({ subject: m['nouns.transfer']({ count: 1 }) }),
									priority: 2
								},
								on: {
									UNLINK_TRANSFER: (args) => {
										if (!(args.guards.canUnlink(args) && args.guards.transferLinked(args))) return
										return {
											target: 'operating.active',
											context: (({ context, event }) => {
												if (event.type !== 'UNLINK_TRANSFER' || !context.linkedTransfer) return {}
												const identityId = context.observation.facts.identityId
												const organizationId = context.observation.facts.organizationId
												if (!identityId || !organizationId) return {}
												return {
													unlinkInput: {
														db,
														identityId,
														organizationId,
														transferId: context.linkedTransfer.id,
														expenseTransactionId: context.linkedTransfer.expenseTransactionId,
														incomeTransactionId: context.linkedTransfer.incomeTransactionId,
														trackWrite: trackTransferWrite
													},
													unlinkResult: null
												}
											})(args)
										}
									},
									SCOPE_CHANGED: (args) => {
										return {
											target: 'idle',
											context: ((args) => ({
												transferObservation: undefined,
												candidates: [],
												selectedCandidateId: null,
												writableCandidateIds: new Set<string>(),
												linkedTransfer: null,
												unlinkWritable: false,
												linkResult: null,
												unlinkResult: null,
												deleteInput: undefined,
												deleteResult: null
											}))(args)
										}
									},
									SHUTDOWN: { target: 'unlinkClosed' }
								}
							},
							rejected: {
								initial: 'classifying',
								states: {
									classifying: {
										always: (args) => {
											const { context } = args
											if (
												context.unlinkResult?.outcome === 'cancelled' ||
												context.unlinkResult?.outcome === 'closed'
											) {
												return { target: 'cancelled' }
											}
											if (context.unlinkResult?.outcome === 'recoveryRequired') {
												return { target: 'recoveryRequired' }
											}
											return { target: 'failed' }
										}
									},
									cancelled: {
										meta: { transferStatus: () => m['status.cancelled'](), priority: 2 }
									},
									recoveryRequired: {
										meta: { transferStatus: () => m['transfers.recovery_required'](), priority: 2 }
									},
									failed: {
										meta: {
											transferStatus: () =>
												m['errors.save_subject']({ subject: m['nouns.transfer']({ count: 1 }) }),
											priority: 2
										}
									}
								},
								on: {
									UNLINK_TRANSFER: (args) => {
										if (!(args.guards.canUnlink(args) && args.guards.transferLinked(args))) return
										return {
											target: 'operating.active',
											context: (({ context, event }) => {
												if (event.type !== 'UNLINK_TRANSFER' || !context.linkedTransfer) return {}
												const identityId = context.observation.facts.identityId
												const organizationId = context.observation.facts.organizationId
												if (!identityId || !organizationId) return {}
												return {
													unlinkInput: {
														db,
														identityId,
														organizationId,
														transferId: context.linkedTransfer.id,
														expenseTransactionId: context.linkedTransfer.expenseTransactionId,
														incomeTransactionId: context.linkedTransfer.incomeTransactionId,
														trackWrite: trackTransferWrite
													},
													unlinkResult: null
												}
											})(args)
										}
									},
									SCOPE_CHANGED: (args) => {
										return {
											target: 'idle',
											context: ((args) => ({
												transferObservation: undefined,
												candidates: [],
												selectedCandidateId: null,
												writableCandidateIds: new Set<string>(),
												linkedTransfer: null,
												unlinkWritable: false,
												linkResult: null,
												unlinkResult: null,
												deleteInput: undefined,
												deleteResult: null
											}))(args)
										}
									},
									SHUTDOWN: { target: 'unlinkClosed' }
								}
							},
							unlinkClosed: { type: 'final' }
						}
					},
					deletion: {
						initial: 'idle',
						states: {
							idle: {
								on: {
									DELETE_LINKED_TRANSFER: (args) => {
										if (!args.guards.canDelete(args)) return
										return {
											target: 'operating.active',
											context: (({ context, event }) => {
												if (event.type !== 'DELETE_LINKED_TRANSFER' || !context.linkedTransfer)
													return {}
												const identityId = context.observation.facts.identityId
												const organizationId = context.observation.facts.organizationId
												if (!identityId || !organizationId) return {}
												return {
													deleteInput: {
														db,
														identityId,
														organizationId,
														transferId: context.linkedTransfer.id,
														expenseTransactionId: context.linkedTransfer.expenseTransactionId,
														incomeTransactionId: context.linkedTransfer.incomeTransactionId,
														choice: event.choice,
														trackWrite: trackTransferWrite
													},
													deleteResult: null
												}
											})(args)
										}
									},
									SCOPE_CHANGED: (args) => {
										return {
											context: ((args) => ({
												transferObservation: undefined,
												candidates: [],
												selectedCandidateId: null,
												writableCandidateIds: new Set<string>(),
												linkedTransfer: null,
												unlinkWritable: false,
												linkResult: null,
												unlinkResult: null,
												deleteInput: undefined,
												deleteResult: null
											}))(args)
										}
									},
									SHUTDOWN: { target: 'deletionClosed' }
								}
							},
							operating: {
								meta: {
									deleteFeedback: { label: () => m['forms.settling'](), variant: 'loading' }
								},
								initial: 'active',
								invoke: {
									id: 'deleteOperation',
									src: 'deleteOperation',
									input: ({
										context
									}): Extract<TransferMutationRequestInput, { operation: 'delete' }> => ({
										workspaceId: required(context.deleteInput).organizationId,
										operation: 'delete',
										input: required(context.deleteInput)
									}),
									onDone: (args) => {
										const { event } = args
										if (
											matchesState({ running: { deletion: { operating: 'closing' } } }, args.value)
										) {
											return { target: '#transaction-edit-form.running.deletion.deletionClosed' }
										}
										if (
											matchesState(
												{ running: { deletion: { operating: 'replacing' } } },
												args.value
											)
										) {
											return {
												target: '#transaction-edit-form.running.deletion.idle',
												context: { deleteInput: undefined, deleteResult: null }
											}
										}
										if (
											event.output.operation === 'delete' &&
											event.output.result.outcome === 'succeeded'
										) {
											return {
												target: '#transaction-edit-form.running.deletion.succeeded',
												context: {
													deleteResult: deleteResult(event.output),
													deleteInput: undefined
												}
											}
										}
										return {
											target: '#transaction-edit-form.running.deletion.rejected',
											context: { deleteResult: deleteResult(event.output), deleteInput: undefined }
										}
									},
									onError: (args) => {
										if (
											matchesState({ running: { deletion: { operating: 'closing' } } }, args.value)
										) {
											return { target: '#transaction-edit-form.running.deletion.deletionClosed' }
										}
										if (
											matchesState(
												{ running: { deletion: { operating: 'replacing' } } },
												args.value
											)
										) {
											return {
												target: '#transaction-edit-form.running.deletion.idle',
												context: { deleteInput: undefined, deleteResult: null }
											}
										}
										return {
											target: '#transaction-edit-form.running.deletion.rejected',
											context: {
												deleteResult: {
													outcome: 'unavailable',
													settlement: 'unresolved',
													error: args.event.error
												},
												deleteInput: undefined
											}
										}
									}
								},
								states: {
									active: {
										on: {
											SCOPE_CHANGED: (args, enq) => {
												{
													const child = args.children.deleteOperation
													if (child?.getSnapshot().status === 'active')
														enq.sendTo(child, { type: 'SHUTDOWN' })
												}
												return { target: 'replacing' }
											},
											SHUTDOWN: (args, enq) => {
												{
													const child = args.children.deleteOperation
													if (child?.getSnapshot().status === 'active')
														enq.sendTo(child, { type: 'SHUTDOWN' })
												}
												return { target: 'closing' }
											}
										}
									},
									closing: {},
									replacing: {
										on: {
											SHUTDOWN: (args, enq) => {
												{
													const child = args.children.deleteOperation
													if (child?.getSnapshot().status === 'active')
														enq.sendTo(child, { type: 'SHUTDOWN' })
												}
												return { target: 'closing' }
											}
										}
									}
								}
							},
							succeeded: {
								initial: 'classifying',
								states: {
									classifying: {
										always: (args) => {
											const { context } = args
											if (
												context.deleteResult?.outcome === 'succeeded' &&
												context.deleteResult.choice.kind === 'both'
											) {
												return { target: 'both' }
											}
											return { target: 'selected' }
										}
									},
									both: {
										meta: {
											deleteFeedback: {
												label: () => m['transfers.delete_saved_both'](),
												variant: 'success'
											}
										}
									},
									selected: {
										meta: {
											deleteFeedback: {
												label: () => m['transfers.delete_saved_selected'](),
												variant: 'success'
											}
										}
									}
								},
								on: {
									DELETE_LINKED_TRANSFER: (args) => {
										if (!args.guards.canDelete(args)) return
										return {
											target: 'operating.active',
											context: (({ context, event }) => {
												if (event.type !== 'DELETE_LINKED_TRANSFER' || !context.linkedTransfer)
													return {}
												const identityId = context.observation.facts.identityId
												const organizationId = context.observation.facts.organizationId
												if (!identityId || !organizationId) return {}
												return {
													deleteInput: {
														db,
														identityId,
														organizationId,
														transferId: context.linkedTransfer.id,
														expenseTransactionId: context.linkedTransfer.expenseTransactionId,
														incomeTransactionId: context.linkedTransfer.incomeTransactionId,
														choice: event.choice,
														trackWrite: trackTransferWrite
													},
													deleteResult: null
												}
											})(args)
										}
									},
									SCOPE_CHANGED: (args) => {
										return {
											target: 'idle',
											context: ((args) => ({
												transferObservation: undefined,
												candidates: [],
												selectedCandidateId: null,
												writableCandidateIds: new Set<string>(),
												linkedTransfer: null,
												unlinkWritable: false,
												linkResult: null,
												unlinkResult: null,
												deleteInput: undefined,
												deleteResult: null
											}))(args)
										}
									},
									SHUTDOWN: { target: 'deletionClosed' }
								}
							},
							rejected: {
								initial: 'classifying',
								states: {
									classifying: {
										always: (args) => {
											const { context } = args
											if (
												context.deleteResult?.outcome === 'cancelled' ||
												context.deleteResult?.outcome === 'closed'
											) {
												return { target: 'cancelled' }
											}
											if (context.deleteResult?.outcome === 'recoveryRequired') {
												return { target: 'recoveryRequired' }
											}
											return { target: 'failed' }
										}
									},
									cancelled: {},
									recoveryRequired: {
										meta: {
											deleteFeedback: {
												label: () => m['transfers.recovery_required'](),
												variant: 'error'
											}
										}
									},
									failed: {
										meta: {
											deleteFeedback: {
												label: () =>
													m['errors.save_subject']({
														subject: m['nouns.transaction']({ count: 2 })
													}),
												variant: 'error'
											}
										}
									}
								},
								on: {
									DELETE_LINKED_TRANSFER: (args) => {
										if (!args.guards.canDelete(args)) return
										return {
											target: 'operating.active',
											context: (({ context, event }) => {
												if (event.type !== 'DELETE_LINKED_TRANSFER' || !context.linkedTransfer)
													return {}
												const identityId = context.observation.facts.identityId
												const organizationId = context.observation.facts.organizationId
												if (!identityId || !organizationId) return {}
												return {
													deleteInput: {
														db,
														identityId,
														organizationId,
														transferId: context.linkedTransfer.id,
														expenseTransactionId: context.linkedTransfer.expenseTransactionId,
														incomeTransactionId: context.linkedTransfer.incomeTransactionId,
														choice: event.choice,
														trackWrite: trackTransferWrite
													},
													deleteResult: null
												}
											})(args)
										}
									},
									SCOPE_CHANGED: (args) => {
										return {
											target: 'idle',
											context: ((args) => ({
												transferObservation: undefined,
												candidates: [],
												selectedCandidateId: null,
												writableCandidateIds: new Set<string>(),
												linkedTransfer: null,
												unlinkWritable: false,
												linkResult: null,
												unlinkResult: null,
												deleteInput: undefined,
												deleteResult: null
											}))(args)
										}
									},
									SHUTDOWN: { target: 'deletionClosed' }
								}
							},
							deletionClosed: { type: 'final' }
						}
					}
				}
			}
		}
	})
	type EditSnapshot = SnapshotFrom<typeof logic>
	const selectFormView = (snapshot: EditSnapshot): TransactionEntryView => {
		const operationPending =
			snapshot.context.linkInput !== undefined ||
			snapshot.context.unlinkInput !== undefined ||
			snapshot.context.deleteInput !== undefined
		return operationPending
			? {
					...snapshot.context.formView,
					canSubmit: false,
					canReset: false,
					canCancel: false,
					fieldsEditable: false
				}
			: snapshot.context.formView
	}
	const selectTransferState = (snapshot: EditSnapshot): TransactionEditTransferState => {
		const state = snapshot.value
		if (!isRecord(state) || !isRecord(state.running)) return 'unselected'
		const transfer = state.running.transfer
		if (transfer === 'conflicted') return 'conflicted'
		if (transfer === 'linked') return 'linked'
		if (transfer === 'searching') return 'searching'
		if (transfer === 'matches') return 'matches'
		if (transfer === 'empty') return 'empty'
		if (transfer === 'failed') return 'failed'
		return 'unselected'
	}
	return {
		logic,
		selectFormView,
		selectTransferStatus: (snapshot: EditSnapshot): TransferStatusLabel | null => {
			const metadata = Object.values(snapshot.getMeta()).filter((meta) => meta?.transferStatus)
			const entries = metadata.flatMap((meta) => (meta?.transferStatus ? [meta] : []))
			entries.sort((a, b) => (b?.priority ?? 0) - (a?.priority ?? 0))
			return entries[0]?.transferStatus ?? null
		},
		selectDeleteFeedback: (snapshot: EditSnapshot): TransferDeleteFeedback | null =>
			Object.values(snapshot.getMeta()).find((meta) => meta?.deleteFeedback)?.deleteFeedback ??
			null,
		selectTransferState,
		isLinkPending: (snapshot: EditSnapshot) => snapshot.context.linkInput !== undefined,
		isUnlinkPending: (snapshot: EditSnapshot) => snapshot.context.unlinkInput !== undefined,
		isDeletePending: (snapshot: EditSnapshot) => snapshot.context.deleteInput !== undefined,
		writableCandidateIds: (snapshot: EditSnapshot) =>
			selectFormView(snapshot).fieldsEditable && snapshot.context.linkInput === undefined
				? snapshot.context.writableCandidateIds
				: new Set<string>(),
		unlinkWritable: (snapshot: EditSnapshot) =>
			selectFormView(snapshot).fieldsEditable && snapshot.context.unlinkInput === undefined
				? snapshot.context.unlinkWritable
				: false
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function transferCandidates(facts: TransactionEntryObservation, observation: TransferObservation) {
	return facts.transaction
		? findInternalTransferCounterparts(
				facts.transaction,
				observation.rows,
				new Set(observation.linkedTransactionIds)
			)
		: []
}

function writableCandidates(
	facts: TransactionEntryObservation,
	candidates: readonly InternalTransferCandidate[]
) {
	const transaction = facts.transaction
	return new Set(
		candidates
			.filter(
				(candidate) =>
					transaction &&
					canWriteAccount(
						facts.membership,
						facts.organizationId,
						transaction.accountId,
						facts.grants
					) &&
					canWriteAccount(facts.membership, facts.organizationId, candidate.accountId, facts.grants)
			)
			.map(({ id }) => id)
	)
}

function writableLinkedTransfer(
	facts: TransactionEntryObservation,
	transfer: InternalTransfer | null
) {
	return Boolean(
		transfer?.expenseAccountId &&
		transfer.incomeAccountId &&
		canWriteAccount(
			facts.membership,
			facts.organizationId,
			transfer.expenseAccountId,
			facts.grants
		) &&
		canWriteAccount(facts.membership, facts.organizationId, transfer.incomeAccountId, facts.grants)
	)
}
