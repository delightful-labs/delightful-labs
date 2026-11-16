import { createActor, createCallbackLogic, setup, types } from 'xstate'
import { vi } from 'vitest'
import { createWorkerCallbackCustody } from 'delightful-local-first/worker/callback-custody'
import type {
	BrokerHostOperation,
	BrokerHostReply,
	BrokerHostResult
} from 'delightful-local-first/backend/jazz/worker-broker'
import { prepareFinanceSdkCall } from '../../runtime/worker/sdk-call-binding.js'
import { createFinanceSdkCallOwner } from './worker-sdk-call-owner.js'
import type { FinanceSdkCallbackResult } from './worker-sdk-call-contracts.js'
import type {
	FinanceSdkCallCustody,
	FinanceSdkCallOwnerInput,
	FinanceSdkCallOwnerEvent,
	FinanceSdkCallReport
} from './worker-sdk-call-owner-contracts.js'
import type { FinanceGrantOwnerEvent } from './worker-grant-contracts.js'

export const sdkKey = 'jazz:shared-worker-generation:jazz-runtime:callback-fixture'
export const sdkOrigin = 'https://finance.example'
export const sdkOpen: BrokerHostOperation = {
	type: 'OPEN',
	url: `${sdkOrigin}/broker.js`,
	name: 'jazz-runtime:callback-fixture:generation-2'
}
type MutableInput = {
	-readonly [Field in keyof FinanceSdkCallOwnerInput]: FinanceSdkCallOwnerInput[Field]
}

/** Native recipient/ports plus a real fault-gate chart. The grant endpoint is
 * controllable for direct/model tests; integration tests supply the real owner.
 * No fixture callback derives policy from the call owner's private snapshot. */
export function sdkCallFixture(
	options: {
		operation?: BrokerHostOperation
		grantTo?: FinanceSdkCallOwnerInput['grantTo']
		grant?: FinanceSdkCallOwnerInput['grant']
		closeRequestId?: string
		register?: boolean
		autoFaultAck?: boolean
		autoSdkReceipt?: boolean
		throwRecipient?: boolean
		start?: boolean
		configure?: (input: MutableInput) => void
	} = {}
) {
	const grant = options.grant ?? {
		runtimeId: crypto.randomUUID(),
		grantId: crypto.randomUUID(),
		acquisitionId: crypto.randomUUID()
	}
	const identity = { runtimeId: grant.runtimeId, requestId: crypto.randomUUID() }
	const close = { scope: grant.grantId, requestId: options.closeRequestId ?? crypto.randomUUID() }
	const wire = { scope: grant.grantId, requestId: identity.requestId, sequence: 1 }
	const order: string[] = [],
		reports: FinanceSdkCallReport[] = [],
		requests: Extract<FinanceGrantOwnerEvent, { type: 'REQUEST' }>['call'][] = []
	const sdkResults: FinanceSdkCallbackResult[] = [],
		errors: unknown[] = [],
		ports = new Set<MessagePort>()
	const sdk = Promise.withResolvers<BrokerHostReply>()
	let promiseOutcome: 'resolved' | 'rejected' | undefined
	const observedPromise = sdk.promise.then(
		() => {
			promiseOutcome = 'resolved'
		},
		() => {
			promiseOutcome = 'rejected'
		}
	)
	let owner: { send: (event: FinanceSdkCallOwnerEvent) => void } | undefined
	function callOwner() {
		if (!owner) throw new Error('Fixture callback owner unavailable')
		return owner
	}
	const discard = vi.fn((reply: BrokerHostReply) => {
		if (reply.type === 'OPENED') reply.port.close()
	})
	const custody: FinanceSdkCallCustody = createWorkerCallbackCustody({
		sameIdentity: (a, b) => a.runtimeId === b.runtimeId && a.requestId === b.requestId,
		discard
	})
	const nativePosts = vi.fn()
	const gate = createActor(
		setup({
			schemas: {
				events: {
					SDK_CALL_REQUIRES_FAULT:
						types<
							Omit<Extract<FinanceSdkCallReport, { type: 'SDK_CALL_REQUIRES_FAULT' }>, 'type'>
						>(),
					SDK_CALL_DELIVERED:
						types<Omit<Extract<FinanceSdkCallReport, { type: 'SDK_CALL_DELIVERED' }>, 'type'>>(),
					SDK_CALL_BLOCKED:
						types<Omit<Extract<FinanceSdkCallReport, { type: 'SDK_CALL_BLOCKED' }>, 'type'>>(),
					ACK: types(),
					ATTEMPT_NATIVE_OPEN: types(),
					CLOSE_ADMISSION: types()
				}
			}
		}).createMachine({
			initial: 'accepting',
			on: {
				CLOSE_ADMISSION: { target: '.faulted' },
				SDK_CALL_DELIVERED: ({ event }, enq) =>
					enq(() => {
						reports.push(event)
					}),
				SDK_CALL_REQUIRES_FAULT: ({ event }, enq) => {
					enq(() => {
						reports.push(event)
						order.push('admission-closed')
					})
					if (options.autoFaultAck !== false)
						enq(() => callOwner().send({ type: 'ADMISSION_FAULTED', identity }))
					return { target: '.faulted' }
				},
				SDK_CALL_BLOCKED: ({ event }, enq) => {
					enq(() => {
						reports.push(event)
					})
					return { target: '.faulted' }
				}
			},
			states: {
				accepting: { on: { ATTEMPT_NATIVE_OPEN: (_, enq) => enq(nativePosts), ACK: {} } },
				faulted: {
					on: {
						ATTEMPT_NATIVE_OPEN: {},
						ACK: (_, enq) => enq(() => callOwner().send({ type: 'ADMISSION_FAULTED', identity }))
					}
				}
			}
		})
	)
	const endpoint = createActor(
		createCallbackLogic<FinanceGrantOwnerEvent>(({ receive }) =>
			receive((event) => {
				if (event.type === 'REQUEST') {
					order.push('request')
					requests.push(event.call)
				}
			})
		)
	)
	function sdkReceipt() {
		callOwner().send({ type: 'SDK_CALLBACK_SETTLED', identity })
	}
	const recipient = vi.fn((result: FinanceSdkCallbackResult) => {
		sdkResults.push(result)
		if (options.throwRecipient) throw new Error('Fixture SDK recipient failed before settlement')
		if (result.kind === 'succeeded') sdk.resolve(result.response)
		else sdk.reject(result)
		order.push('sdk-settled')
		if (options.autoSdkReceipt !== false) sdkReceipt()
	})
	if (options.register !== false)
		custody.register({
			identity,
			settle: recipient,
			stopped: { kind: 'interrupted', reason: 'closed', effectOutcome: 'not-issued' }
		})
	const prepared = prepareFinanceSdkCall({
		identity,
		operation: options.operation ?? { type: 'WRITE', key: sdkKey, value: '2' },
		origin: sdkOrigin,
		onBrokerResult: (result) => {
			const token = result.kind === 'succeeded' ? custody.capture(result.response) : undefined
			callOwner().send({ type: 'BROKER_RESULT', identity, result, token })
		}
	})
	const recordStopResult = vi.fn<FinanceSdkCallCustody['recordStopResult']>((id, result) => {
		order.push('record-stop')
		custody.recordStopResult(id, result)
	})
	const deliver = vi.fn<FinanceSdkCallCustody['deliver']>((id, result, token) =>
		custody.deliver(id, result, token)
	)
	const configuration: MutableInput = {
		prepared,
		grant,
		closeRequestId: close.requestId,
		grantTo: options.grantTo ?? endpoint,
		reportTo: gate,
		custody: { recordStopResult, deliver }
	}
	options.configure?.(configuration)
	const actor = createActor(createFinanceSdkCallOwner(), { input: configuration })
	owner = actor
	actor.subscribe({ error: (error) => errors.push(error) })
	gate.start()
	endpoint.start()
	if (options.start !== false) actor.start()
	function pair() {
		const pair = new MessageChannel()
		ports.add(pair.port1)
		ports.add(pair.port2)
		return pair
	}
	return {
		actor,
		gate,
		endpoint,
		identity,
		grant,
		close,
		wire,
		configuration,
		prepared,
		custody,
		recordStopResult,
		deliver,
		discard,
		recipient,
		sdkResults,
		requests,
		reports,
		order,
		errors,
		nativePosts,
		observedPromise,
		pair,
		promiseOutcome: () => promiseOutcome,
		available: () => actor.send({ type: 'GRANT_AVAILABLE', identity: grant }),
		ackFault: () => gate.send({ type: 'ACK' }),
		sdkReceipt,
		closed: () => actor.send({ type: 'GRANT_CLOSED', identity: grant, receipt: close }),
		result(result: BrokerHostResult) {
			prepared.call.settle(result)
		},
		success(response: BrokerHostReply = { type: 'RESULT', value: null }) {
			prepared.call.settle({ kind: 'succeeded', identity: wire, response })
		},
		failure(effectOutcome: 'unknown' | 'not-issued' = 'unknown') {
			prepared.call.settle({ kind: 'failed', identity: wire, reason: 'timeout', effectOutcome })
		},
		dispose() {
			gate.send({ type: 'CLOSE_ADMISSION' })
			actor.stop()
			try {
				custody.stop()
			} finally {
				gate.stop()
				endpoint.stop()
				for (const port of ports) port.close()
			}
		}
	}
}
