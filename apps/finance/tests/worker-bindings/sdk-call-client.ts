import { createActor, waitFor } from 'xstate'
import { createWorkerCallbackCustody } from 'delightful-local-first/worker/callback-custody'
import type { BrokerHostReply } from 'delightful-local-first/backend/jazz/worker-broker'
import { prepareFinanceSdkCall } from '../../src/lib/runtime/worker/sdk-call-binding.js'
import type {
	FinanceSdkCallCustody,
	FinanceSdkCallOwnerEvent,
	FinanceSdkCallReport
} from '../../src/lib/machines/runtime/worker-sdk-call-owner-contracts.js'
import type { FinanceGrantDescriptor } from '../../src/lib/runtime/worker/grant-binding.js'
import { createGrantFixtureParent } from './grant-owner-parent.js'
import { createSdkCallNativeParent } from './sdk-call-parent.js'

/** One native browser command at the Worker host boundary. Roots are created
 * before SDK settlement, outside promise/I/O actors; no acquisition population
 * or production promise facade is substituted by this fixture. */
export async function qualifySdkCallOwner(
	data: MessagePort,
	control: MessagePort,
	scope: string,
	descriptor: FinanceGrantDescriptor
) {
	if (descriptor.kind !== 'broker')
		throw new Error('Native callback fixture requires a broker grant')
	const grant = {
		runtimeId: crypto.randomUUID(),
		grantId: scope,
		acquisitionId: crypto.randomUUID()
	}
	const identity = { runtimeId: grant.runtimeId, requestId: crypto.randomUUID() }
	const close = { scope, requestId: crypto.randomUUID() }
	const reports: FinanceSdkCallReport[] = []
	let settlements = 0,
		discarded = 0
	let accepted: MessagePort | undefined
	const sdk = Promise.withResolvers<BrokerHostReply>()
	void sdk.promise.catch(() => {})
	const custody: FinanceSdkCallCustody = createWorkerCallbackCustody({
		sameIdentity: (a, b) => a.runtimeId === b.runtimeId && a.requestId === b.requestId,
		discard: (response) => {
			if (response.type === 'OPENED') {
				discarded++
				response.port.close()
			}
		}
	})
	const grantParent = createActor(createGrantFixtureParent(), {
		input: {
			configuration: () => ({
				request: { version: 1, type: 'ACQUIRE_GRANT', ...grant, descriptor },
				origin: location.origin,
				closeRequestId: close.requestId,
				acquisitionTimeoutMs: 5000,
				requestTimeoutMs: 5000,
				closeTimeoutMs: 5000,
				postAcquire: () => {
					grantParent.send({
						type: 'GRANT_REPLY',
						reply: {
							version: 1,
							type: 'GRANT_READY',
							...grant,
							dataPort: data,
							controlPort: control
						}
					})
					return { kind: 'posted' }
				}
			})
		}
	})
	grantParent.subscribe({ error: () => sdk.reject(new Error('Native grant fixture failed')) })
	grantParent.start()
	const grantTo = grantParent.getSnapshot().children.grant
	if (!grantTo) throw new Error('Native grant child unavailable')
	let forward: (event: FinanceSdkCallOwnerEvent) => void = () => {
		throw new Error('Native callback recipient unavailable')
	}
	custody.register({
		identity,
		stopped: { kind: 'interrupted', reason: 'closed', effectOutcome: 'not-issued' },
		settle: (result) => {
			if (result.kind === 'succeeded') sdk.resolve(result.response)
			else sdk.reject(new Error('Native callback rejected'))
			settlements++
			// Deliberately retain the actual settlement receipt until the command
			// observes SDK fulfillment; void keeper return must not free the slot.
		}
	})
	const prepared = prepareFinanceSdkCall({
		identity,
		origin: location.origin,
		operation: { type: 'OPEN', url: descriptor.url, name: descriptor.name },
		onBrokerResult: (result) =>
			forward({
				type: 'BROKER_RESULT',
				identity,
				result,
				token: result.kind === 'succeeded' ? custody.capture(result.response) : undefined
			})
	})
	const parent = createActor(createSdkCallNativeParent(), {
		input: {
			configuration: () => ({
				prepared,
				origin: location.origin,
				grant,
				closeRequestId: close.requestId,
				grantTo,
				custody
			}),
			report: (report) => {
				reports.push(report)
			}
		}
	})
	parent.subscribe({ error: () => sdk.reject(new Error('Native callback parent failed')) })
	forward = (event) => parent.send(event)
	parent.start()
	try {
		await waitFor(grantParent, (snapshot) =>
			snapshot.context.reports.some((report) => report.type === 'GRANT_AVAILABLE')
		)
		parent.send({ type: 'GRANT_AVAILABLE', identity: grant })
		const response = await sdk.promise
		if (response.type !== 'OPENED') throw new Error('Native SDK port unavailable')
		accepted = response.port
		const heldUntilSdkReceipt =
			parent.getSnapshot().output === undefined &&
			reports.every((r) => r.type !== 'SDK_CALL_DELIVERED')
		forward({ type: 'SDK_CALLBACK_SETTLED', identity })
		await waitFor(parent, (snapshot) => snapshot.status === 'done')
		grantParent.send({ type: 'RETIRE' })
		await waitFor(grantParent, (snapshot) => snapshot.status === 'done')
		const closure = grantParent.getSnapshot().output
		custody.stop()
		const echo = new Promise<unknown>((resolve) => {
			response.port.onmessage = (event) => resolve(event.data)
		})
		response.port.postMessage('SDK callback port survives grant and keeper closure')
		return {
			heldUntilSdkReceipt,
			settlements,
			discarded,
			release: parent.getSnapshot().output?.evidence,
			matchingClose:
				closure?.kind === 'closed' &&
				closure.receipt.scope === close.scope &&
				closure.receipt.requestId === close.requestId,
			echo: await echo,
			windowPresent: typeof window !== 'undefined'
		}
	} finally {
		parent.stop()
		grantParent.stop()
		try {
			custody.stop()
		} finally {
			accepted?.close()
			data.close()
			control.close()
		}
	}
}
