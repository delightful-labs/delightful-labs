import {
	brokerHostCall,
	type BrokerHostOperation,
	type BrokerHostResult
} from 'delightful-local-first/backend/jazz/worker-broker'
import {
	financeGrantDescriptor,
	financeGrantScopeSchema,
	type FinanceGrantDescriptor
} from './grant-binding.js'
import type {
	FinancePreparedSdkCall,
	FinanceSdkCallbackIdentity
} from '../../machines/runtime/worker-sdk-call-contracts.js'

/** Pure binding/copy calculation, never callback admission or grant acquisition.
 * onBrokerResult captures a native receipt; the population later selects SDK
 * delivery after observing any failure. No callback is invoked here. */
export function prepareFinanceSdkCall(
	input: Readonly<{
		identity: FinanceSdkCallbackIdentity
		operation: BrokerHostOperation
		/** Already-admitted runtime origin, used for exact same-origin broker binding. */
		origin: string
		onBrokerResult: (result: BrokerHostResult) => void
	}>
): FinancePreparedSdkCall {
	const {
		identity: sourceIdentity,
		operation: sourceOperation,
		origin: sourceOrigin,
		onBrokerResult
	} = input
	let origin: URL
	try {
		origin = new URL(sourceOrigin)
	} catch {
		throw new Error('Invalid Finance SDK callback origin')
	}
	if (
		sourceOrigin.length > 8192 ||
		!['http:', 'https:'].includes(origin.protocol) ||
		origin.username ||
		origin.password
	)
		throw new Error('Invalid Finance SDK callback origin')
	const identity = {
		runtimeId: financeGrantScopeSchema.parse(sourceIdentity.runtimeId),
		requestId: financeGrantScopeSchema.parse(sourceIdentity.requestId)
	}
	if (typeof onBrokerResult !== 'function') throw new Error('Invalid Finance SDK result recipient')
	let descriptor: FinanceGrantDescriptor
	let operation = sourceOperation
	if (operation.type === 'OPEN') {
		const selected = financeGrantDescriptor(
			{ kind: 'broker', url: operation.url, name: operation.name },
			origin.origin
		)
		if (selected.kind !== 'broker') throw new Error('Invalid Finance SDK broker descriptor')
		descriptor = selected
		operation = { ...operation, url: selected.url }
	} else {
		descriptor = financeGrantDescriptor({ kind: 'generation', key: operation.key }, origin.origin)
	}
	// Validate/copy once through the public broker contract after canonicalization,
	// preserving strict fields, WRITE representation and expanded URL bounds.
	const call = brokerHostCall(identity.requestId, operation, onBrokerResult)
	// Only owned plain records are frozen; native callbacks/resources stay opaque.
	Object.freeze(call.request)
	return Object.freeze({
		identity: Object.freeze(identity),
		descriptor: Object.freeze(descriptor),
		call: Object.freeze(call),
		payloadBytes: new TextEncoder().encode(JSON.stringify(call.request)).byteLength
	})
}
