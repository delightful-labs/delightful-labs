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
	type Context = {
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
	const actors = {
		admit: fromPromise(({ input }: { input: { credentials: Credentials } }) =>
			effect(() => capability.admit(input.credentials))
		),
		open: fromPromise(({ input }: { input: { transactions: Transactions } }) =>
			effect(() => input.transactions.open())
		),
		read: fromPromise(
			({
				input
			}: {
				input: {
					transaction: Transaction
					identity: InvitationAuthorityIdentity
					accountId: string
				}
			}) => effect(() => capability.read(input.transaction, input.identity, input.accountId))
		),
		verify: fromPromise(({ input }: { input: { code: string; digest: string } }) =>
			effect(() => capability.verifyCode(input.code, input.digest))
		),
		clock: fromPromise(() => effect(() => capability.now())),
		prepare: fromPromise(() => effect(() => capability.newMembershipId())),
		stage: fromPromise(
			({ input }: { input: { transaction: Transaction; plan: InvitationAuthorityPlan<Role> } }) =>
				effect(() => capability.stage(input.transaction, input.plan))
		),
		commit: fromPromise(
			({ input }: { input: { transactions: Transactions; transaction: Transaction } }) =>
				effect(() => input.transactions.commit(input.transaction))
		),
		confirm: fromPromise(({ input }: { input: { transactions: Transactions; write: Write } }) =>
			effect(() => input.transactions.confirm(input.write))
		),
		rollback: fromPromise(
			({ input }: { input: { transactions: Transactions; transaction: Transaction } }) =>
				effect(() => input.transactions.rollback(input.transaction))
		)
	}

	const model = setup<
		Context,
		InvitationAuthorityEvent,
		typeof actors,
		{},
		{
			clear: undefined
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
							accountId: required(context.admission).accountId,
							transaction: required(context.transaction),
							write: context.write,
							access: {
								confirm: required(context.admission).transactions.confirm.bind(
									required(context.admission).transactions
								),
								rollback: required(context.admission).transactions.rollback.bind(
									required(context.admission).transactions
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
		transactions: required(context.admission).transactions,
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
				clear
			]
		})
	return model.createMachine({
		id: 'invitation-authority',
		initial: 'running',
		context: ({ input }) => ({
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
										transactions: required(context.admission).transactions
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
										identity: context.identity,
										accountId: required(context.admission).accountId
									}),
									onDone: [
										{
											guard: ({ event }) =>
												event.output.outcome === 'succeeded' &&
												event.output.value.outcome === 'observed',
											target: 'checkingRead',
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
							checkingRead: { always: [...interrupted, { target: 'correlating' }] },
							correlating: {
								always: [
									{
										guard: ({ context }) =>
											required(context.records).invitation?.id !== context.identity.invitationId,
										target: 'rollingBack',
										actions: decide({ outcome: 'invalid' })
									},
									{
										guard: ({ context }) => {
											const records = required(context.records),
												invitation = required(records.invitation ?? undefined),
												accountId = required(context.admission).accountId
											return Boolean(
												records.membership &&
												(records.membership.workspaceId !== invitation.workspaceId ||
													records.membership.accountId !== accountId)
											)
										},
										target: 'rollingBack',
										actions: failure
									},
									{
										guard: ({ context }) => {
											const records = required(context.records),
												invitation = required(records.invitation ?? undefined),
												evidence = records.evidence
											return Boolean(
												evidence &&
												(evidence.operationId !== context.identity.operationId ||
													evidence.invitationId !== context.identity.invitationId ||
													evidence.workspaceId !== invitation.workspaceId ||
													evidence.accountId !== required(context.admission).accountId)
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
										digest: required(required(context.records).invitation ?? undefined).codeDigest
									}),
									onDone: [
										{
											guard: ({ event }) =>
												event.output.outcome === 'succeeded' && event.output.value === true,
											target: 'checkingVerification',
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
							checkingVerification: { always: [...interrupted, { target: 'checkingEvidence' }] },
							checkingEvidence: {
								always: [
									{
										guard: ({ context }) => {
											const records = required(context.records)
											return (
												records.evidence !== null &&
												records.membership?.id === records.evidence.membershipId
											)
										},
										target: 'rollingBack',
										actions: decide((context) => ({
											outcome: 'joined',
											membershipId: required(required(context.records).evidence ?? undefined)
												.membershipId
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
											membershipId: required(required(context.records).membership ?? undefined).id
										}))
									},
									{ target: 'checkingRevocation' }
								]
							},
							checkingRevocation: {
								always: [
									{
										guard: ({ context }) =>
											required(required(context.records).invitation ?? undefined).revoked,
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
											target: 'checkingClock',
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
							checkingClock: { always: [...interrupted, { target: 'checkingExpiry' }] },
							checkingExpiry: {
								always: [
									{
										guard: ({ context }) => {
											const expiresAt = required(
												required(context.records).invitation ?? undefined
											).expiresAt
											return expiresAt !== null && !Number.isFinite(expiresAt)
										},
										target: 'rollingBack',
										actions: failure
									},
									{
										guard: ({ context }) => {
											const expiresAt = required(
												required(context.records).invitation ?? undefined
											).expiresAt
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
										guard: ({ context }) =>
											required(required(context.records).invitation ?? undefined).consumed !== null,
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
										{
											guard: ({ event }) =>
												event.output.outcome === 'succeeded' && Boolean(event.output.value.trim()),
											target: 'checkingPreparation',
											actions: assign({
												plan: ({ context, event }) => {
													if (event.output.outcome !== 'succeeded')
														throw new Error('Expected prepared membership identity')
													const invitation = required(
														required(context.records).invitation ?? undefined
													)
													return {
														...context.identity,
														accountId: required(context.admission).accountId,
														workspaceId: invitation.workspaceId,
														membershipId: event.output.value,
														role: invitation.role,
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
							checkingPreparation: { always: [...interrupted, { target: 'staging' }] },
							staging: {
								invoke: {
									src: 'stage',
									input: ({ context }) => ({
										transaction: required(context.transaction),
										plan: required(context.plan)
									}),
									onDone: [
										{
											guard: ({ event }) => event.output.outcome === 'succeeded',
											target: 'checkingStage',
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
							checkingStage: { always: [...interrupted, { target: 'committing' }] },
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
										transactions: required(context.admission).transactions,
										write: required(context.write)
									}),
									onDone: [
										{
											guard: ({ event }) => event.output.outcome === 'succeeded',
											target: 'finishing',
											actions: assign({
												result: ({ context }: { context: Context }): Result => ({
													...context.identity,
													outcome: 'completed',
													settlement: { kind: 'confirmed', decision: required(context.decision) }
												})
											})
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
											target: 'finishing'
										},
										{ target: 'finishing', actions: unresolved }
									],
									onError: { target: 'finishing', actions: unresolved }
								}
							},
							finishing: {
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
			settled: { type: 'final', entry: clear },
			cancelled: terminal('cancelled'),
			closed: terminal('closed')
		}
	})
}
