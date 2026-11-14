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
	const { identity: sourceIdentity, operation: sourceOperation, origin, onBrokerResult } = input
	const identity = {
		runtimeId: financeGrantScopeSchema.parse(sourceIdentity.runtimeId),
		requestId: financeGrantScopeSchema.parse(sourceIdentity.requestId)
	}
	if (typeof onBrokerResult !== 'function') throw new Error('Invalid Finance SDK result recipient')
	// Validate/copy through the existing public broker contract, including its
	// stricter WRITE generation representation and payload field bounds.
	const original = brokerHostCall(identity.requestId, sourceOperation, onBrokerResult)
	let descriptor: FinanceGrantDescriptor
	let operation = original.request
	if (operation.type === 'OPEN') {
		const selected = financeGrantDescriptor(
			{ kind: 'broker', url: operation.url, name: operation.name },
			origin
		)
		if (selected.kind !== 'broker') throw new Error('Invalid Finance SDK broker descriptor')
		descriptor = selected
		operation = { ...operation, url: selected.url }
	} else {
		descriptor = financeGrantDescriptor({ kind: 'generation', key: operation.key }, origin)
	}
	// Canonical URL expansion must still fit the actual wire operation schema.
	const call = brokerHostCall(identity.requestId, operation, onBrokerResult)
	return {
		identity,
		descriptor,
		call,
		payloadBytes: new TextEncoder().encode(JSON.stringify(call.request)).byteLength
	}
}
