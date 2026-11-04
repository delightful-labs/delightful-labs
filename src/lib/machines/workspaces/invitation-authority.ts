import {
	createTransactionCustody,
	clearTransactionCustody,
	transactionCall,
	transactionCustodian,
	type TransactionCustody
} from './transaction-custody.js'
import { assign, fromPromise, setup, stateIn } from 'xstate'
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

type Effect<Value> = { outcome: 'succeeded'; value: Value } | { outcome: 'failed' }
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
	record: { workspaceId: string; accountId: string },
	workspaceId: string,
	accountId: string
): boolean {
	return record.workspaceId === workspaceId && record.accountId === accountId
}

/** Server-only resource owner. The host receives and owns any unresolved transaction handoff. */
export function createInvitationAuthorityMachine<Credentials, Transaction, Write, Role>(
	capability: InvitationAuthorityCapability<Credentials, Transaction, Write, Role>
) {
	type Input = { credentials: Credentials; request: InvitationAuthorityRequest }
	type Admission = Extract<
		InvitationAuthorityAdmission<Transaction, Write>,
		{ outcome: 'admitted' }
	>
	type Transactions = InvitationAuthorityTransactions<Transaction, Write>
	type Result = InvitationAuthorityResult<Transaction, Write>
	type Custody = TransactionCustody<Transaction, Readonly<{ write: Write }>>
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
		custodian: transactionCustodian<Transaction, Readonly<{ write: Write }>>(),
		admit: fromPromise(({ input }: { input: { credentials: Credentials } }) =>
			effect(() => capability.admit(input.credentials))
		),
		open: fromPromise(({ input }: { input: { transactions: Transactions; custody: Custody } }) => {
			input.custody.retain = (receipt) => input.transactions.retainDetached(receipt)
			const call = transactionCall(input.custody, () => input.transactions.open())
			input.custody.acquisition = call
			return effect(() => call)
		}),
		read: fromPromise(
			({
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
		),
		verify: fromPromise(({ input }: { input: { code: string; digest: string } }) =>
			effect(() => capability.verifyCode(input.code, input.digest))
		),
		clock: fromPromise(() => effect(() => capability.now())),
		prepare: fromPromise(() => effect(() => capability.newMembershipId())),
		stage: fromPromise(
			({
				input
			}: {
				input: { transaction: Transaction; plan: InvitationAuthorityPlan<Role>; custody: Custody }
			}) =>
				effect(() =>
					transactionCall(input.custody, () => capability.stage(input.transaction, input.plan))
				)
		),
		commit: fromPromise(
			({
				input
			}: {
				input: { transactions: Transactions; transaction: Transaction; custody: Custody }
			}) => {
				const call = transactionCall(input.custody, () =>
					input.transactions.commit(input.transaction)
				)
				input.custody.commit = call
				return effect(() => call)
			}
		),
		confirm: fromPromise(
			({ input }: { input: { transactions: Transactions; write: Write; custody: Custody } }) =>
				effect(() => transactionCall(input.custody, () => input.transactions.confirm(input.write)))
		),
		rollback: fromPromise(
			({
				input
			}: {
				input: { transactions: Transactions; transaction: Transaction; custody: Custody }
			}) =>
				effect(() =>
					transactionCall(input.custody, () => input.transactions.rollback(input.transaction))
				)
		)
	}

	const model = setup<
		Context,
		InvitationAuthorityEvent,
		typeof actors,
		{},
		{
			clear: undefined
			releaseCustody: undefined
			failure: undefined
			unresolved: undefined
			decide: { decision: InvitationDecision }
		},
		{ closing: undefined; cancelling: undefined },
		never,
		string,
		Input,
		Result
	>({
		actors,
		actions: {
			releaseCustody: ({ context }) => clearTransactionCustody(context.custody),
			clear: assign({
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
			failure: assign({
				result: ({ context }): Result => ({
					...context.identity,
					outcome: 'failed',
					settlement: { kind: 'notStarted' }
				})
			}),
			unresolved: assign({
				result: ({ context }): Result => ({
					...context.identity,
					outcome: 'failed',
					settlement: {
						kind: 'unknown',
						retained: {
							accountId: admitted(context).accountId,
							transaction: required(context.transaction),
							write: context.write,
							access: {
								confirm: admitted(context).transactions.confirm.bind(
									admitted(context).transactions
								),
								rollback: admitted(context).transactions.rollback.bind(
									admitted(context).transactions
								)
							}
						}
					}
				})
			}),
			decide: assign({
				result: ({ context }, params: { decision: InvitationDecision }): Result => ({
					...context.identity,
					outcome: 'completed',
					settlement: { kind: 'confirmed', decision: params.decision }
				})
			})
		},
		guards: {
			closing: stateIn({ running: { control: 'closing' } }),
			cancelling: stateIn({ running: { control: 'cancelling' } })
		}
	})
	const clear = 'clear'
	const failure = 'failure'
	const unresolved = 'unresolved'
	const decide = (
		decision: InvitationDecision | ((context: Context) => InvitationDecision)
	): {
		type: 'decide'
		params: (args: { context: Context }) => { decision: InvitationDecision }
	} => ({
		type: 'decide',
		params: ({ context }) => ({
			decision: typeof decision === 'function' ? decision(context) : decision
		})
	})
	const transactionInput = ({ context }: { context: Context }) => ({
		custody: context.custody,
		transactions: admitted(context).transactions,
		transaction: required(context.transaction)
	})
	const interrupted = [
		{ guard: 'closing', target: 'rollingBack' },
		{ guard: 'cancelling', target: 'rollingBack' }
	] satisfies { guard: 'closing' | 'cancelling'; target: string }[]
	const finishInterrupted = [
		{ guard: 'closing', target: 'finishing' },
		{ guard: 'cancelling', target: 'finishing' }
	] satisfies { guard: 'closing' | 'cancelling'; target: string }[]
	const terminal = (outcome: 'cancelled' | 'closed') =>
		model.createStateConfig({
			type: 'final',
			entry: [
				model.assign({
					result: ({ context }: { context: Context }): Result => ({
						...context.identity,
						outcome,
						settlement: context.result?.settlement ?? { kind: 'notStarted' }
					})
				}),
				'releaseCustody',
				clear
			]
		})
	return model.createMachine({
		id: 'invitation-authority',
		initial: 'running',
		context: ({ input }) => ({
			custody: createTransactionCustody<Transaction, Readonly<{ write: Write }>>(),
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
					src: 'custodian',
					input: ({ context, self }) => ({ custody: context.custody, owner: self }),
					onError: {
						actions: () => {
							throw new Error('Transaction custody failed')
						}
					}
				},
				states: {
					control: {
						initial: 'active',
						states: {
							active: { on: { CANCEL: 'cancelling', SHUTDOWN: 'closing' } },
							cancelling: { on: { CANCEL: {}, SHUTDOWN: 'closing' } },
							closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
						}
					},
					work: {
						initial: 'validating',
						states: {
							validating: {
								always: [
									{
										guard: ({ context }) =>
											Boolean(
												context.identity.operationId.trim() &&
												context.identity.invitationId.trim() &&
												context.request?.code.trim()
											),
										target: 'admitting'
									},
									{
										target: 'finishing',
										actions: assign({
											result: ({ context }: { context: Context }): Result => ({
												...context.identity,
												outcome: 'invalidRequest',
												settlement: { kind: 'notStarted' }
											})
										})
									}
								]
							},
							admitting: {
								invoke: {
									src: 'admit',
									input: ({ context }) => ({ credentials: required(context.credentials) }),
									onDone: [
										{
											guard: ({ event }) =>
												event.output.outcome === 'succeeded' &&
												event.output.value.outcome === 'admitted',
											target: 'checkingAdmission',
											actions: assign({
												credentials: undefined,
												admission: ({ event }) =>
													event.output.outcome === 'succeeded' &&
													event.output.value.outcome === 'admitted'
														? event.output.value
														: undefined
											})
										},
										{
											target: 'finishing',
											actions: assign({
												credentials: undefined,
												result: ({ context, event }): Result => ({
													...context.identity,
													outcome:
														event.output.outcome === 'succeeded' &&
														event.output.value.outcome === 'unauthenticated'
															? 'unauthenticated'
															: 'unavailable',
													settlement: { kind: 'notStarted' }
												})
											})
										}
									],
									onError: {
										target: 'finishing',
										actions: assign({
											credentials: undefined,
											result: ({ context }: { context: Context }): Result => ({
												...context.identity,
												outcome: 'unavailable',
												settlement: { kind: 'notStarted' }
											})
										})
									}
								}
							},
							checkingAdmission: { always: [...finishInterrupted, { target: 'acquiring' }] },
							acquiring: {
								invoke: {
									src: 'open',
									input: ({ context }) => ({
										transactions: admitted(context).transactions,
										custody: context.custody
									}),
									onDone: [
										{
											guard: ({ event }) => event.output.outcome === 'succeeded',
											target: 'checkingAcquisition',
											actions: assign({
												transaction: ({ event }) =>
													event.output.outcome === 'succeeded' ? event.output.value : undefined
											})
										},
										{ target: 'finishing', actions: failure }
									],
									onError: { target: 'finishing', actions: failure }
								}
							},
							checkingAcquisition: { always: [...interrupted, { target: 'reading' }] },
							reading: {
								invoke: {
									src: 'read',
									input: ({ context }) => ({
										transaction: required(context.transaction),
										custody: context.custody,
										identity: context.identity,
										accountId: admitted(context).accountId
									}),
									onDone: [
										{
											guard: ({ event }) =>
												event.output.outcome === 'succeeded' &&
												event.output.value.outcome === 'observed',
											target: 'correlating',
											actions: assign({
												records: ({ event }) =>
													event.output.outcome === 'succeeded' &&
													event.output.value.outcome === 'observed'
														? event.output.value.records
														: undefined
											})
										},
										{ target: 'rollingBack', actions: failure }
									],
									onError: { target: 'rollingBack', actions: failure }
								}
							},
							correlating: {
								always: [
									...interrupted,
									{
										guard: ({ context }) =>
											records(context).invitation?.id !== context.identity.invitationId,
										target: 'rollingBack',
										actions: decide({ outcome: 'invalid' })
									},
									{
										guard: ({ context }) => {
											const member = records(context).membership
											return (
												member !== null &&
												!matchesWorkspaceAccount(
													member,
													invitation(context).workspaceId,
													admitted(context).accountId
												)
											)
										},
										target: 'rollingBack',
										actions: failure
									},
									{
										guard: ({ context }) => {
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
										},
										target: 'rollingBack',
										actions: failure
									},
									{ target: 'verifyingCode' }
								]
							},
							verifyingCode: {
								invoke: {
									src: 'verify',
									input: ({ context }) => ({
										code: required(context.request).code,
										digest: invitation(context).codeDigest
									}),
									onDone: [
										{
											guard: ({ event }) =>
												event.output.outcome === 'succeeded' && event.output.value === true,
											target: 'checkingEvidence',
											actions: assign({ request: undefined })
										},
										{
											guard: ({ event }) => event.output.outcome === 'succeeded',
											target: 'rollingBack',
											actions: [decide({ outcome: 'invalid' }), assign({ request: undefined })]
										},
										{ target: 'rollingBack', actions: [failure, assign({ request: undefined })] }
									],
									onError: {
										target: 'rollingBack',
										actions: [failure, assign({ request: undefined })]
									}
								}
							},
							checkingEvidence: {
								always: [
									...interrupted,
									{
										guard: ({ context }) => {
											const snapshot = records(context)
											return (
												snapshot.evidence !== null &&
												snapshot.membership?.id === snapshot.evidence.membershipId
											)
										},
										target: 'rollingBack',
										actions: decide((context) => ({
											outcome: 'joined',
											membershipId: required(records(context).evidence ?? undefined).membershipId
										}))
									},
									{
										guard: ({ context }) => required(context.records).evidence !== null,
										target: 'rollingBack',
										actions: decide({ outcome: 'denied' })
									},
									{ target: 'checkingMembership' }
								]
							},
							checkingMembership: {
								always: [
									{
										guard: ({ context }) => required(context.records).membership !== null,
										target: 'rollingBack',
										actions: decide((context) => ({
											outcome: 'alreadyMember',
											membershipId: required(records(context).membership ?? undefined).id
										}))
									},
									{ target: 'checkingRevocation' }
								]
							},
							checkingRevocation: {
								always: [
									{
										guard: ({ context }) => invitation(context).revoked,
										target: 'rollingBack',
										actions: decide({ outcome: 'revoked' })
									},
									{ target: 'readingClock' }
								]
							},
							readingClock: {
								invoke: {
									src: 'clock',
									onDone: [
										{
											guard: ({ event }) =>
												event.output.outcome === 'succeeded' && Number.isFinite(event.output.value),
											target: 'checkingExpiry',
											actions: assign({
												now: ({ event }) =>
													event.output.outcome === 'succeeded' ? event.output.value : undefined
											})
										},
										{ target: 'rollingBack', actions: failure }
									],
									onError: { target: 'rollingBack', actions: failure }
								}
							},
							checkingExpiry: {
								always: [
									...interrupted,
									{
										guard: ({ context }) => {
											const expiresAt = invitation(context).expiresAt
											return expiresAt !== null && !Number.isFinite(expiresAt)
										},
										target: 'rollingBack',
										actions: failure
									},
									{
										guard: ({ context }) => {
											const expiresAt = invitation(context).expiresAt
											return expiresAt !== null && required(context.now) >= expiresAt
										},
										target: 'rollingBack',
										actions: decide({ outcome: 'expired' })
									},
									{ target: 'checkingConsumption' }
								]
							},
							checkingConsumption: {
								always: [
									{
										guard: ({ context }) => invitation(context).consumed !== null,
										target: 'rollingBack',
										actions: decide({ outcome: 'used' })
									},
									{ target: 'preparing' }
								]
							},
							preparing: {
								invoke: {
									src: 'prepare',
									onDone: [
										...interrupted,
										{
											guard: ({ event }) =>
												event.output.outcome === 'succeeded' && Boolean(event.output.value.trim()),
											target: 'staging',
											actions: assign({
												plan: ({ context, event }) => {
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
												}
											})
										},
										{ target: 'rollingBack', actions: failure }
									],
									onError: { target: 'rollingBack', actions: failure }
								}
							},
							staging: {
								invoke: {
									src: 'stage',
									input: ({ context }) => ({
										transaction: required(context.transaction),
										custody: context.custody,
										plan: required(context.plan)
									}),
									onDone: [
										...interrupted,
										{
											guard: ({ event }) => event.output.outcome === 'succeeded',
											target: 'committing',
											actions: assign({
												decision: ({ context }): InvitationDecision => ({
													outcome: 'joined',
													membershipId: required(context.plan).membershipId
												})
											})
										},
										{ target: 'rollingBack', actions: failure }
									],
									onError: { target: 'rollingBack', actions: failure }
								}
							},
							committing: {
								invoke: {
									src: 'commit',
									input: transactionInput,
									onDone: [
										{
											guard: ({ event }) => event.output.outcome === 'succeeded',
											target: 'confirming',
											actions: assign({
												write: ({ event }) =>
													event.output.outcome === 'succeeded'
														? event.output.value.write
														: undefined
											})
										},
										{ target: 'finishing', actions: unresolved }
									],
									onError: { target: 'finishing', actions: unresolved }
								}
							},
							confirming: {
								invoke: {
									src: 'confirm',
									input: ({ context }) => ({
										custody: context.custody,
										transactions: admitted(context).transactions,
										write: required(context.write)
									}),
									onDone: [
										{
											guard: ({ event }) => event.output.outcome === 'succeeded',
											target: 'finishing',
											actions: [
												({ context }) => clearTransactionCustody(context.custody),
												assign({
													result: ({ context }: { context: Context }): Result => ({
														...context.identity,
														outcome: 'completed',
														settlement: { kind: 'confirmed', decision: required(context.decision) }
													})
												})
											]
										},
										{ target: 'finishing', actions: unresolved }
									],
									onError: { target: 'finishing', actions: unresolved }
								}
							},
							rollingBack: {
								invoke: {
									src: 'rollback',
									input: transactionInput,
									onDone: [
										{
											guard: ({ event }) =>
												event.output.outcome === 'succeeded' && event.output.value === true,
											target: 'finishing',
											actions: ({ context }) => clearTransactionCustody(context.custody)
										},
										{ target: 'finishing', actions: unresolved }
									],
									onError: { target: 'finishing', actions: unresolved }
								}
							},
							finishing: {
								entry: 'releaseCustody',
								always: [
									{ guard: 'closing', target: '#invitation-authority.closed' },
									{ guard: 'cancelling', target: '#invitation-authority.cancelled' },
									{ target: '#invitation-authority.settled' }
								]
							}
						}
					}
				}
			},
			settled: { type: 'final', entry: ['releaseCustody', clear] },
			cancelled: terminal('cancelled'),
			closed: terminal('closed')
		}
	})
}
