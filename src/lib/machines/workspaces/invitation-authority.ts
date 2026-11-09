import { matchesState, type StateValue, types, createAsyncLogic, setup } from 'xstate'
import { createFinalTransitions } from '../finalize.js'

import type { EventPayload } from '../../contracts/machine-events.js'
import {
	createTransactionCustody,
	clearTransactionCustody,
	transactionCall,
	transactionCustodian,
	type TransactionCustody
} from './transaction-custody.js'
import type { InvitationDecision } from '../../contracts/workspace-invitation.js'
import type {
	InvitationAuthorityAdmission,
	InvitationAuthorityCapability,
	InvitationAuthorityEvent,
	InvitationAuthorityIdentity,
	InvitationAuthorityPlan,
	InvitationAuthorityRecords,
	InvitationAuthorityRequest,
	InvitationAuthorityResult,
	InvitationAuthorityTransactions
} from '../../contracts/workspace-invitation-authority.js'
type Effect<Value> =
	| {
			outcome: 'succeeded'
			value: Value
	  }
	| {
			outcome: 'failed'
	  }
/** Normalize one effect's exception; never retain errors which could contain credentials or codes. */
async function effect<Value>(operation: () => Value | PromiseLike<Value>): Promise<Effect<Value>> {
	try {
		return { outcome: 'succeeded', value: await operation() }
	} catch {
		return { outcome: 'failed' }
	}
}
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing invitation authority resource')
	return value
}
function matchesWorkspaceAccount(
	record: {
		workspaceId: string
		accountId: string
	},
	workspaceId: string,
	accountId: string
): boolean {
	return record.workspaceId === workspaceId && record.accountId === accountId
}
/** Server-only resource owner. The host receives and owns any unresolved transaction handoff. */
export function createInvitationAuthorityMachine<Credentials, Transaction, Write, Role>(
	capability: InvitationAuthorityCapability<Credentials, Transaction, Write, Role>
) {
	type Input = {
		credentials: Credentials
		request: InvitationAuthorityRequest
	}
	type Admission = Extract<
		InvitationAuthorityAdmission<Transaction, Write>,
		{
			outcome: 'admitted'
		}
	>
	type Transactions = InvitationAuthorityTransactions<Transaction, Write>
	type Result = InvitationAuthorityResult<Transaction, Write>
	type Custody = TransactionCustody<
		Transaction,
		Readonly<{
			write: Write
		}>
	>
	type Context = {
		custody: Custody
		identity: InvitationAuthorityIdentity
		credentials: Credentials | undefined
		request: InvitationAuthorityRequest | undefined
		admission: Admission | undefined
		transaction: Transaction | undefined
		records: InvitationAuthorityRecords<Role> | undefined
		now: number | undefined
		plan: InvitationAuthorityPlan<Role> | undefined
		decision: InvitationDecision | undefined
		write: Write | undefined
		result: Result | undefined
	}
	const records = (context: Context) => required(context.records)
	const invitation = (context: Context) => required(records(context).invitation ?? undefined)
	const admitted = (context: Context) => required(context.admission)
	const actors = {
		custodian: transactionCustodian<
			Transaction,
			Readonly<{
				write: Write
			}>
		>(),
		admit: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					credentials: Credentials
				}
			}) => effect(() => capability.admit(input.credentials))
		}),
		open: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					transactions: Transactions
					custody: Custody
				}
			}) => {
				input.custody.bindRetainer((receipt) => input.transactions.retainDetached(receipt))
				const call = transactionCall(input.custody, () => input.transactions.open())
				input.custody.recordAcquisition(call)
				return effect(() => call)
			}
		}),
		read: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					transaction: Transaction
					custody: Custody
					identity: InvitationAuthorityIdentity
					accountId: string
				}
			}) =>
				effect(() =>
					transactionCall(input.custody, () =>
						capability.read(input.transaction, input.identity, input.accountId)
					)
				)
		}),
		verify: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					code: string
					digest: string
				}
			}) => effect(() => capability.verifyCode(input.code, input.digest))
		}),
		clock: createAsyncLogic({ run: () => effect(() => capability.now()) }),
		prepare: createAsyncLogic({ run: () => effect(() => capability.newMembershipId()) }),
		stage: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					transaction: Transaction
					plan: InvitationAuthorityPlan<Role>
					custody: Custody
				}
			}) =>
				effect(() =>
					transactionCall(input.custody, () => capability.stage(input.transaction, input.plan))
				)
		}),
		commit: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					transactions: Transactions
					transaction: Transaction
					custody: Custody
				}
			}) => {
				const call = transactionCall(input.custody, () =>
					input.transactions.commit(input.transaction)
				)
				input.custody.recordCommit(call)
				return effect(() => call)
			}
		}),
		confirm: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					transactions: Transactions
					write: Write
					custody: Custody
				}
			}) =>
				effect(() => transactionCall(input.custody, () => input.transactions.confirm(input.write)))
		}),
		rollback: createAsyncLogic({
			run: ({
				input
			}: {
				input: {
					transactions: Transactions
					transaction: Transaction
					custody: Custody
				}
			}) =>
				effect(() =>
					transactionCall(input.custody, () => input.transactions.rollback(input.transaction))
				)
		})
	}
	const patches = {
		clear: (_args: { context: Context }): Partial<Context> => ({
			credentials: undefined,
			request: undefined,
			admission: undefined,
			transaction: undefined,
			records: undefined,
			now: undefined,
			plan: undefined,
			decision: undefined,
			write: undefined
		}),
		failure: ({ context }: { context: Context }): Partial<Context> => ({
			result: {
				...context.identity,
				outcome: 'failed',
				settlement: { kind: 'notStarted' }
			}
		}),
		unresolved: ({ context }: { context: Context }): Partial<Context> => ({
			result: {
				...context.identity,
				outcome: 'failed',
				settlement: {
					kind: 'unknown',
					retained: {
						accountId: admitted(context).accountId,
						transaction: required(context.transaction),
						write: context.write,
						access: {
							confirm: admitted(context).transactions.confirm.bind(admitted(context).transactions),
							rollback: admitted(context).transactions.rollback.bind(admitted(context).transactions)
						}
					}
				}
			}
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<InvitationAuthorityEvent, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<InvitationAuthorityEvent, 'SHUTDOWN'>>()
			},
			input: types<Input>(),
			output: types<Result>()
		},
		actors,
		actions: {
			releaseCustody: ({ context }: { context: Context }) =>
				clearTransactionCustody(context.custody)
		},
		guards: {
			closing: ({ value }: { value: StateValue }) =>
				matchesState({ running: { control: 'closing' } }, value),
			cancelling: ({ value }: { value: StateValue }) =>
				matchesState({ running: { control: 'cancelling' } }, value)
		}
	})
	const transactionInput = ({ context }: { context: Context }) => ({
		custody: context.custody,
		transactions: admitted(context).transactions,
		transaction: required(context.transaction)
	})

	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		settled: (args, enq) => {
			enq(args.actions.releaseCustody, args)
			return { context: patches.clear(args) satisfies Partial<Context> }
		},
		cancelled: (args, enq) => {
			let context = args.context
			let patch = {}
			patch = {
				...patch,
				result: {
					...context.identity,
					outcome: 'cancelled',
					settlement: context.result?.settlement ?? { kind: 'notStarted' }
				}
			}
			context = { ...args.context, ...patch }
			enq(args.actions.releaseCustody, { ...args, context })
			patch = { ...patch, ...patches.clear({ ...args, context }) }
			context = { ...args.context, ...patch }
			return { context: patch satisfies Partial<Context> }
		},
		closed: (args, enq) => {
			let context = args.context
			let patch = {}
			patch = {
				...patch,
				result: {
					...context.identity,
					outcome: 'closed',
					settlement: context.result?.settlement ?? { kind: 'notStarted' }
				}
			}
			context = { ...args.context, ...patch }
			enq(args.actions.releaseCustody, { ...args, context })
			patch = { ...patch, ...patches.clear({ ...args, context }) }
			context = { ...args.context, ...patch }
			return { context: patch satisfies Partial<Context> }
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>
	const complete = createFinalTransitions<
		Context,
		CompletionArgs,
		CompletionQueue,
		keyof typeof finalizers
	>(finalizers)

	return model.createMachine({
		id: 'invitation-authority',
		initial: 'running',
		context: ({ input }) => ({
			custody: createTransactionCustody<
				Transaction,
				Readonly<{
					write: Write
				}>
			>(),
			identity: {
				operationId: input.request.operationId,
				invitationId: input.request.invitationId
			},
			credentials: input.credentials,
			request: { ...input.request },
			admission: undefined,
			transaction: undefined,
			records: undefined,
			now: undefined,
			plan: undefined,
			decision: undefined,
			write: undefined,
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel',
				invoke: {
					src: actors.custodian,
					input: ({ context, self }) => ({ custody: context.custody, owner: self }),
					onError: (args, enq) => {
						enq(() => {
							throw new Error('Transaction custody failed')
						})
					}
				},
				states: {
					control: {
						initial: 'active',
						states: {
							active: { on: { CANCEL: { target: 'cancelling' }, SHUTDOWN: { target: 'closing' } } },
							cancelling: { on: { CANCEL: {}, SHUTDOWN: { target: 'closing' } } },
							closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
						}
					},
					work: {
						initial: 'validating',
						states: {
							validating: {
								always: (args) => {
									const { context } = args
									if (
										context.identity.operationId.trim() &&
										context.identity.invitationId.trim() &&
										context.request?.code.trim()
									) {
										return { target: 'admitting' }
									}
									return {
										target: 'finishing',
										context: {
											result: {
												...context.identity,
												outcome: 'invalidRequest',
												settlement: { kind: 'notStarted' }
											}
										} satisfies Partial<Context>
									}
								}
							},
							admitting: {
								invoke: {
									src: actors.admit,
									input: ({ context }) => ({ credentials: required(context.credentials) }),
									onDone: (args) => {
										const { event } = args
										if (
											event.output.outcome === 'succeeded' &&
											event.output.value.outcome === 'admitted'
										) {
											return {
												target: 'checkingAdmission',
												context: {
													credentials: undefined,
													admission:
														event.output.outcome === 'succeeded' &&
														event.output.value.outcome === 'admitted'
															? event.output.value
															: undefined
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'finishing',
											context: {
												credentials: undefined,
												result: {
													...args.context.identity,
													outcome:
														event.output.outcome === 'succeeded' &&
														event.output.value.outcome === 'unauthenticated'
															? 'unauthenticated'
															: 'unavailable',
													settlement: { kind: 'notStarted' }
												}
											} satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												credentials: undefined,
												result: {
													...args.context.identity,
													outcome: 'unavailable',
													settlement: { kind: 'notStarted' }
												}
											} satisfies Partial<Context>
										}
									}
								}
							},
							checkingAdmission: {
								always: (args) => {
									if (args.guards.closing(args)) {
										return { target: 'finishing' }
									}
									if (args.guards.cancelling(args)) {
										return { target: 'finishing' }
									}
									return { target: 'acquiring' }
								}
							},
							acquiring: {
								invoke: {
									src: actors.open,
									input: ({ context }) => ({
										transactions: admitted(context).transactions,
										custody: context.custody
									}),
									onDone: (args) => {
										const { event } = args
										if (event.output.outcome === 'succeeded') {
											return {
												target: 'checkingAcquisition',
												context: {
													transaction:
														event.output.outcome === 'succeeded' ? event.output.value : undefined
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'finishing',
											context: patches.failure(args) satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: patches.failure(args) satisfies Partial<Context>
										}
									}
								}
							},
							checkingAcquisition: {
								always: (args) => {
									if (args.guards.closing(args)) {
										return { target: 'rollingBack' }
									}
									if (args.guards.cancelling(args)) {
										return { target: 'rollingBack' }
									}
									return { target: 'reading' }
								}
							},
							reading: {
								invoke: {
									src: actors.read,
									input: ({ context }) => ({
										transaction: required(context.transaction),
										custody: context.custody,
										identity: context.identity,
										accountId: admitted(context).accountId
									}),
									onDone: (args) => {
										const { event } = args
										if (
											event.output.outcome === 'succeeded' &&
											event.output.value.outcome === 'observed'
										) {
											return {
												target: 'correlating',
												context: {
													records:
														event.output.outcome === 'succeeded' &&
														event.output.value.outcome === 'observed'
															? event.output.value.records
															: undefined
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'rollingBack',
											context: patches.failure(args) satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: patches.failure(args) satisfies Partial<Context>
										}
									}
								}
							},
							correlating: {
								always: (args, _enq) => {
									if (args.guards.closing(args)) {
										return { target: 'rollingBack' }
									}
									if (args.guards.cancelling(args)) {
										return { target: 'rollingBack' }
									}
									if (
										(({ context }: typeof args) =>
											records(context).invitation?.id !== context.identity.invitationId)(args)
									) {
										let context = args.context
										let patch: Partial<Context> = {}
										patch = {
											...patch,
											...((args: { context: Context }): Partial<Context> => ({
												result: {
													...args.context.identity,
													outcome: 'completed',
													settlement: {
														kind: 'confirmed',
														decision: (({
															context: _context
														}: {
															context: Context
														}): {
															decision: InvitationDecision
														} => ({
															decision: { outcome: 'invalid' }
														}))(args).decision
													}
												}
											}))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										return {
											target: 'rollingBack',
											context: patch satisfies Partial<Context>
										}
									}
									if (
										(({ context }: typeof args) => {
											const member = records(context).membership
											return (
												member !== null &&
												!matchesWorkspaceAccount(
													member,
													invitation(context).workspaceId,
													admitted(context).accountId
												)
											)
										})(args)
									) {
										let context = args.context
										let patch: Partial<Context> = {}
										patch = {
											...patch,
											...((args: { context: Context }) => patches.failure(args))({
												...args,
												context
											})
										}
										context = { ...args.context, ...patch }
										return {
											target: 'rollingBack',
											context: patch satisfies Partial<Context>
										}
									}
									if (
										(({ context }: typeof args) => {
											const evidence = records(context).evidence
											return (
												evidence !== null &&
												(evidence.operationId !== context.identity.operationId ||
													evidence.invitationId !== context.identity.invitationId ||
													!matchesWorkspaceAccount(
														evidence,
														invitation(context).workspaceId,
														admitted(context).accountId
													))
											)
										})(args)
									) {
										let context = args.context
										let patch: Partial<Context> = {}
										patch = {
											...patch,
											...((args: { context: Context }) => patches.failure(args))({
												...args,
												context
											})
										}
										context = { ...args.context, ...patch }
										return {
											target: 'rollingBack',
											context: patch satisfies Partial<Context>
										}
									}
									return { target: 'verifyingCode' }
								}
							},
							verifyingCode: {
								invoke: {
									src: actors.verify,
									input: ({ context }) => ({
										code: required(context.request).code,
										digest: invitation(context).codeDigest
									}),
									onDone: (args, _enq) => {
										if (
											(({ event }: typeof args) =>
												event.output.outcome === 'succeeded' && event.output.value === true)(args)
										) {
											let _context = args.context
											let patch: Partial<Context> = {}
											patch = {
												...patch,
												request: undefined
											}
											_context = { ...args.context, ...patch }
											return {
												target: 'checkingEvidence',
												context: patch satisfies Partial<Context>
											}
										}
										if ((({ event }: typeof args) => event.output.outcome === 'succeeded')(args)) {
											let context = args.context
											let patch: Partial<Context> = {}
											patch = {
												...patch,
												...((args: { context: Context }): Partial<Context> => ({
													result: {
														...args.context.identity,
														outcome: 'completed',
														settlement: {
															kind: 'confirmed',
															decision: (({
																context: _context
															}: {
																context: Context
															}): {
																decision: InvitationDecision
															} => ({
																decision: { outcome: 'invalid' }
															}))(args).decision
														}
													}
												}))({ ...args, context })
											}
											context = { ...args.context, ...patch }
											patch = {
												...patch,
												request: undefined
											}
											context = { ...args.context, ...patch }
											return {
												target: 'rollingBack',
												context: patch satisfies Partial<Context>
											}
										}
										let context = args.context
										let patch: Partial<Context> = {}
										patch = {
											...patch,
											...((args: { context: Context }) => patches.failure(args))({
												...args,
												context
											})
										}
										context = { ...args.context, ...patch }
										patch = {
											...patch,
											request: undefined
										}
										context = { ...args.context, ...patch }
										return {
											target: 'rollingBack',
											context: patch satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: {
												...patches.failure(args),
												request: undefined
											} satisfies Partial<Context>
										}
									}
								}
							},
							checkingEvidence: {
								always: (args, _enq) => {
									if (args.guards.closing(args)) {
										return { target: 'rollingBack' }
									}
									if (args.guards.cancelling(args)) {
										return { target: 'rollingBack' }
									}
									if (
										(({ context }: typeof args) => {
											const snapshot = records(context)
											return (
												snapshot.evidence !== null &&
												snapshot.membership?.id === snapshot.evidence.membershipId
											)
										})(args)
									) {
										let context = args.context
										let patch: Partial<Context> = {}
										patch = {
											...patch,
											...((args: { context: Context }): Partial<Context> => ({
												result: {
													...args.context.identity,
													outcome: 'completed',
													settlement: {
														kind: 'confirmed',
														decision: (({
															context
														}: {
															context: Context
														}): {
															decision: InvitationDecision
														} => ({
															decision: ((context) => ({
																outcome: 'joined',
																membershipId: required(records(context).evidence ?? undefined)
																	.membershipId
															}))(context)
														}))(args).decision
													}
												}
											}))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										return {
											target: 'rollingBack',
											context: patch satisfies Partial<Context>
										}
									}
									if (
										(({ context }: typeof args) => required(context.records).evidence !== null)(
											args
										)
									) {
										let context = args.context
										let patch: Partial<Context> = {}
										patch = {
											...patch,
											...((args: { context: Context }): Partial<Context> => ({
												result: {
													...args.context.identity,
													outcome: 'completed',
													settlement: {
														kind: 'confirmed',
														decision: (({
															context: _context
														}: {
															context: Context
														}): {
															decision: InvitationDecision
														} => ({
															decision: { outcome: 'denied' }
														}))(args).decision
													}
												}
											}))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										return {
											target: 'rollingBack',
											context: patch satisfies Partial<Context>
										}
									}
									return { target: 'checkingMembership' }
								}
							},
							checkingMembership: {
								always: (args, _enq) => {
									if (
										(({ context }: typeof args) => required(context.records).membership !== null)(
											args
										)
									) {
										let context = args.context
										let patch: Partial<Context> = {}
										patch = {
											...patch,
											...((args: { context: Context }): Partial<Context> => ({
												result: {
													...args.context.identity,
													outcome: 'completed',
													settlement: {
														kind: 'confirmed',
														decision: (({
															context
														}: {
															context: Context
														}): {
															decision: InvitationDecision
														} => ({
															decision: ((context) => ({
																outcome: 'alreadyMember',
																membershipId: required(records(context).membership ?? undefined).id
															}))(context)
														}))(args).decision
													}
												}
											}))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										return {
											target: 'rollingBack',
											context: patch satisfies Partial<Context>
										}
									}
									return { target: 'checkingRevocation' }
								}
							},
							checkingRevocation: {
								always: (args, _enq) => {
									if ((({ context }: typeof args) => invitation(context).revoked)(args)) {
										let context = args.context
										let patch: Partial<Context> = {}
										patch = {
											...patch,
											...((args: { context: Context }): Partial<Context> => ({
												result: {
													...args.context.identity,
													outcome: 'completed',
													settlement: {
														kind: 'confirmed',
														decision: (({
															context: _context
														}: {
															context: Context
														}): {
															decision: InvitationDecision
														} => ({
															decision: { outcome: 'revoked' }
														}))(args).decision
													}
												}
											}))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										return {
											target: 'rollingBack',
											context: patch satisfies Partial<Context>
										}
									}
									return { target: 'readingClock' }
								}
							},
							readingClock: {
								invoke: {
									src: actors.clock,
									onDone: (args) => {
										const { event } = args
										if (
											event.output.outcome === 'succeeded' &&
											Number.isFinite(event.output.value)
										) {
											return {
												target: 'checkingExpiry',
												context: {
													now: event.output.outcome === 'succeeded' ? event.output.value : undefined
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'rollingBack',
											context: patches.failure(args) satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: patches.failure(args) satisfies Partial<Context>
										}
									}
								}
							},
							checkingExpiry: {
								always: (args, _enq) => {
									if (args.guards.closing(args)) {
										return { target: 'rollingBack' }
									}
									if (args.guards.cancelling(args)) {
										return { target: 'rollingBack' }
									}
									if (
										(({ context }: typeof args) => {
											const expiresAt = invitation(context).expiresAt
											return expiresAt !== null && !Number.isFinite(expiresAt)
										})(args)
									) {
										let context = args.context
										let patch: Partial<Context> = {}
										patch = {
											...patch,
											...((args: { context: Context }) => patches.failure(args))({
												...args,
												context
											})
										}
										context = { ...args.context, ...patch }
										return {
											target: 'rollingBack',
											context: patch satisfies Partial<Context>
										}
									}
									if (
										(({ context }: typeof args) => {
											const expiresAt = invitation(context).expiresAt
											return expiresAt !== null && required(context.now) >= expiresAt
										})(args)
									) {
										let context = args.context
										let patch: Partial<Context> = {}
										patch = {
											...patch,
											...((args: { context: Context }): Partial<Context> => ({
												result: {
													...args.context.identity,
													outcome: 'completed',
													settlement: {
														kind: 'confirmed',
														decision: (({
															context: _context
														}: {
															context: Context
														}): {
															decision: InvitationDecision
														} => ({
															decision: { outcome: 'expired' }
														}))(args).decision
													}
												}
											}))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										return {
											target: 'rollingBack',
											context: patch satisfies Partial<Context>
										}
									}
									return { target: 'checkingConsumption' }
								}
							},
							checkingConsumption: {
								always: (args, _enq) => {
									if ((({ context }: typeof args) => invitation(context).consumed !== null)(args)) {
										let context = args.context
										let patch: Partial<Context> = {}
										patch = {
											...patch,
											...((args: { context: Context }): Partial<Context> => ({
												result: {
													...args.context.identity,
													outcome: 'completed',
													settlement: {
														kind: 'confirmed',
														decision: (({
															context: _context
														}: {
															context: Context
														}): {
															decision: InvitationDecision
														} => ({
															decision: { outcome: 'used' }
														}))(args).decision
													}
												}
											}))({ ...args, context })
										}
										context = { ...args.context, ...patch }
										return {
											target: 'rollingBack',
											context: patch satisfies Partial<Context>
										}
									}
									return { target: 'preparing' }
								}
							},
							preparing: {
								invoke: {
									src: actors.prepare,
									onDone: (args) => {
										const { event } = args
										if (args.guards.closing(args)) {
											return { target: 'rollingBack' }
										}
										if (args.guards.cancelling(args)) {
											return { target: 'rollingBack' }
										}
										if (
											event.output.outcome === 'succeeded' &&
											Boolean(event.output.value.trim())
										) {
											return {
												target: 'staging',
												context: {
													plan: (({ context, event }) => {
														if (event.output.outcome !== 'succeeded')
															throw new Error('Expected prepared membership identity')
														const preparedInvitation = invitation(context)
														return {
															...context.identity,
															accountId: admitted(context).accountId,
															workspaceId: preparedInvitation.workspaceId,
															membershipId: event.output.value,
															role: preparedInvitation.role,
															acceptedAt: required(context.now)
														}
													})(args)
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'rollingBack',
											context: ((args) => patches.failure(args))(args) satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: patches.failure(args) satisfies Partial<Context>
										}
									}
								}
							},
							staging: {
								invoke: {
									src: actors.stage,
									input: ({ context }) => ({
										transaction: required(context.transaction),
										custody: context.custody,
										plan: required(context.plan)
									}),
									onDone: (args) => {
										if (args.guards.closing(args)) {
											return { target: 'rollingBack' }
										}
										if (args.guards.cancelling(args)) {
											return { target: 'rollingBack' }
										}
										if (args.event.output.outcome === 'succeeded') {
											return {
												target: 'committing',
												context: {
													decision: {
														outcome: 'joined',
														membershipId: required(args.context.plan).membershipId
													}
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'rollingBack',
											context: ((args) => patches.failure(args))(args) satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'rollingBack',
											context: patches.failure(args) satisfies Partial<Context>
										}
									}
								}
							},
							committing: {
								invoke: {
									src: actors.commit,
									input: transactionInput,
									onDone: (args) => {
										const { event } = args
										if (event.output.outcome === 'succeeded') {
											return {
												target: 'confirming',
												context: {
													write:
														event.output.outcome === 'succeeded'
															? event.output.value.write
															: undefined
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'finishing',
											context: patches.unresolved(args) satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: patches.unresolved(args) satisfies Partial<Context>
										}
									}
								}
							},
							confirming: {
								invoke: {
									src: actors.confirm,
									input: ({ context }) => ({
										custody: context.custody,
										transactions: admitted(context).transactions,
										write: required(context.write)
									}),
									onDone: (args, enq) => {
										const { context } = args
										if (args.event.output.outcome === 'succeeded') {
											enq(({ context }) => clearTransactionCustody(context.custody), args)
											return {
												target: 'finishing',
												context: {
													result: {
														...context.identity,
														outcome: 'completed',
														settlement: {
															kind: 'confirmed',
															decision: required(context.decision)
														}
													}
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'finishing',
											context: patches.unresolved(args) satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: patches.unresolved(args) satisfies Partial<Context>
										}
									}
								}
							},
							rollingBack: {
								invoke: {
									src: actors.rollback,
									input: transactionInput,
									onDone: (args, enq) => {
										const { event } = args
										if (event.output.outcome === 'succeeded' && event.output.value === true) {
											enq(() => clearTransactionCustody(args.context.custody))
											return { target: 'finishing' }
										}
										return {
											target: 'finishing',
											context: patches.unresolved(args) satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: patches.unresolved(args) satisfies Partial<Context>
										}
									}
								}
							},
							finishing: {
								entry: (args, enq) => {
									enq(args.actions.releaseCustody, args)
								},
								always: (args, enq) => {
									if (matchesState({ running: { control: 'closing' } }, args.value)) {
										{
											return complete('closed', args, enq, {
												target: '#invitation-authority.closed'
											})
										}
									}
									if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
										{
											return complete('cancelled', args, enq, {
												target: '#invitation-authority.cancelled'
											})
										}
									}
									{
										return complete('settled', args, enq, {
											target: '#invitation-authority.settled'
										})
									}
								}
							}
						}
					}
				}
			},
			settled: {
				type: 'final'
			},
			cancelled: {
				type: 'final'
			},
			closed: {
				type: 'final'
			}
		}
	})
}
