import { setImmediate } from 'node:timers/promises'
import { expect, it } from 'vitest'
import * as fc from 'fast-check'
import { propertyTest, assertTestCoverage, type TestSut } from '@xstate/test'
import { setup, types, type EventFrom, type SnapshotFrom } from 'xstate'
import { sdkCallFixture } from '../../src/lib/machines/runtime/worker-sdk-call-owner.test-support.js'

// External obligation ledger: one dispatch permit, first accepted result,
// parent fault acknowledgement, recipient receipt and original close receipt.
// It has no production state paths, child snapshots or implementation context.
type Facts = {
	dispatched: boolean
	result:
		'success' | 'failed' | 'refused' | 'cancelled' | 'closed-effect' | 'closed-query' | undefined
	faultNeeded: boolean
	faultAck: boolean
	sdkReceipt: boolean
	closed: boolean
	stopped: boolean
	forcedSettlement: boolean
	openAdmission: boolean
	nativeOpens: number
}
const initial: Facts = {
	dispatched: false,
	result: undefined,
	faultNeeded: false,
	faultAck: false,
	sdkReceipt: false,
	closed: false,
	stopped: false,
	forcedSettlement: false,
	openAdmission: true,
	nativeOpens: 0
}
function offeredToSdk(r: Facts) {
	return r.result !== undefined && (!r.faultNeeded || r.faultAck)
}
function retained(r: Facts) {
	return r.result === 'failed' || r.result === 'closed-effect'
}
function release(r: Facts) {
	if (!offeredToSdk(r) || !r.sdkReceipt || (retained(r) && !r.closed)) return undefined
	return retained(r) ? 'grant-closed' : 'definitive-result'
}
const contract = setup({
	schemas: {
		context: types<{ facts: Facts }>(),
		events: {
			AVAILABLE: types<{ current: boolean }>(),
			RESULT: types<{ current: boolean; kind: 'success' | 'failed' | 'refused' }>(),
			FAULT_ACK: types<{ current: boolean }>(),
			SDK_RECEIPT: types<{ current: boolean }>(),
			CLOSE: types<{ current: boolean }>(),
			CANCEL: types(),
			TRY_OPEN: types(),
			STOP: types()
		}
	}
}).createMachine({
	context: { facts: initial },
	initial: 'exercising',
	states: {
		exercising: {
			on: {
				AVAILABLE: ({ context, event }) => {
					const r = context.facts
					if (r.stopped || release(r) || r.result !== undefined || r.dispatched || !event.current)
						return
					return { context: { facts: { ...r, dispatched: true } } }
				},
				RESULT: ({ context, event }) => {
					const r = context.facts
					if (r.stopped || release(r) || !r.dispatched || r.result !== undefined || !event.current)
						return
					return {
						context: {
							facts: {
								...r,
								result: event.kind,
								faultNeeded: event.kind !== 'success',
								openAdmission: event.kind === 'success' ? r.openAdmission : false
							}
						}
					}
				},
				FAULT_ACK: ({ context, event }) => {
					const r = context.facts
					if (r.stopped || release(r) || !event.current || !r.faultNeeded) return
					return { context: { facts: { ...r, faultAck: true } } }
				},
				SDK_RECEIPT: ({ context, event }) => {
					const r = context.facts
					if (r.stopped || release(r) || !event.current || !offeredToSdk(r)) return
					return { context: { facts: { ...r, sdkReceipt: true } } }
				},
				CLOSE: ({ context, event }) => {
					const r = context.facts
					if (r.stopped || release(r) || !event.current) return
					const interrupted = r.result === undefined
					return {
						context: {
							facts: {
								...r,
								closed: true,
								result: r.result ?? (r.dispatched ? 'closed-effect' : 'closed-query'),
								faultNeeded: interrupted || r.faultNeeded,
								openAdmission: interrupted ? false : r.openAdmission
							}
						}
					}
				},
				CANCEL: ({ context }) => {
					const r = context.facts
					if (r.stopped || release(r)) return
					return {
						context: {
							facts: {
								...r,
								openAdmission: false,
								result: r.result ?? (r.dispatched ? undefined : 'cancelled')
							}
						}
					}
				},
				TRY_OPEN: ({ context }) => ({
					context: {
						facts: {
							...context.facts,
							nativeOpens: context.facts.nativeOpens + (context.facts.openAdmission ? 1 : 0)
						}
					}
				}),
				STOP: ({ context }) => {
					const r = context.facts
					if (r.stopped || release(r)) return { context: { facts: { ...r, openAdmission: false } } }
					return {
						context: {
							facts: {
								...r,
								stopped: true,
								openAdmission: false,
								forcedSettlement: !offeredToSdk(r)
							}
						}
					}
				}
			}
		}
	}
})
type Observation = {
	dispatches: number
	sdkSettlements: number
	deliveryReports: number
	faultReports: number
	release: string | undefined
	nativeOpens: number
}
async function flush() {
	await Promise.resolve()
	await setImmediate()
}
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create() {
		const f = sdkCallFixture({ autoFaultAck: false, autoSdkReceipt: false })
		let stopped = false
		return {
			async send(event) {
				if (event.type === 'TRY_OPEN') f.gate.send({ type: 'ATTEMPT_NATIVE_OPEN' })
				else if (event.type === 'STOP') {
					f.gate.send({ type: 'CLOSE_ADMISSION' })
					if (f.actor.getSnapshot().status === 'active') {
						stopped = true
						f.actor.stop()
						f.custody.stop()
					}
				} else if (!stopped && f.actor.getSnapshot().status === 'active') {
					if (event.type === 'AVAILABLE')
						f.actor.send({
							type: 'GRANT_AVAILABLE',
							identity: {
								...f.grant,
								acquisitionId: event.current ? f.grant.acquisitionId : crypto.randomUUID()
							}
						})
					else if (event.type === 'CANCEL') {
						f.gate.send({ type: 'CLOSE_ADMISSION' })
						f.actor.send({ type: 'CANCEL_WAITING', identity: f.identity, reason: 'closed' })
					} else if (event.type === 'RESULT') {
						const identity = {
							...f.wire,
							scope: event.current ? f.wire.scope : crypto.randomUUID()
						}
						if (event.kind === 'success')
							f.result({ kind: 'succeeded', identity, response: { type: 'RESULT', value: null } })
						else if (event.kind === 'failed')
							f.result({ kind: 'failed', identity, reason: 'timeout', effectOutcome: 'unknown' })
						else
							f.result({
								kind: 'refused',
								scope: identity.scope,
								requestId: identity.requestId,
								reason: 'rejected',
								effectOutcome: 'not-issued'
							})
					} else if (event.type === 'FAULT_ACK')
						f.actor.send({
							type: 'ADMISSION_FAULTED',
							identity: {
								...f.identity,
								requestId: event.current ? f.identity.requestId : crypto.randomUUID()
							}
						})
					else if (event.type === 'SDK_RECEIPT')
						f.actor.send({
							type: 'SDK_CALLBACK_SETTLED',
							identity: {
								...f.identity,
								requestId: event.current ? f.identity.requestId : crypto.randomUUID()
							}
						})
					else
						f.actor.send({
							type: 'GRANT_CLOSED',
							identity: f.grant,
							receipt: {
								...f.close,
								requestId: event.current ? f.close.requestId : crypto.randomUUID()
							}
						})
				}
				await flush()
			},
			read(): Observation {
				return {
					dispatches: f.requests.length,
					sdkSettlements: f.sdkResults.length,
					deliveryReports: f.reports.filter((r) => r.type === 'SDK_CALL_DELIVERED').length,
					faultReports: f.reports.filter((r) => r.type === 'SDK_CALL_REQUIRES_FAULT').length,
					release: f.actor.getSnapshot().output?.evidence,
					nativeOpens: f.nativePosts.mock.calls.length
				}
			},
			dispose: () => f.dispose()
		}
	},
	projectModel: ({ context }): Observation => {
		const r = context.facts
		return {
			dispatches: Number(r.dispatched),
			sdkSettlements: Number(offeredToSdk(r) || r.forcedSettlement),
			deliveryReports: Number(offeredToSdk(r) && r.sdkReceipt),
			faultReports: Number(r.faultNeeded),
			release: r.stopped ? undefined : release(r),
			nativeOpens: r.nativeOpens
		}
	}
}
it('matches generated dispatch, fault-gate, SDK receipt, close, cancellation and stop obligations', async () => {
	const { coverage } = await propertyTest(contract, {
		events: {
			AVAILABLE: fc.record({ current: fc.boolean() }),
			RESULT: fc.record({
				current: fc.boolean(),
				kind: fc.constantFrom('success', 'failed', 'refused')
			}),
			FAULT_ACK: fc.record({ current: fc.boolean() }),
			SDK_RECEIPT: fc.record({ current: fc.boolean() }),
			CLOSE: fc.record({ current: fc.boolean() }),
			CANCEL: fc.constant({}),
			TRY_OPEN: fc.constant({}),
			STOP: fc.constant({})
		},
		sut,
		seed: 20261115,
		numRuns: 400,
		maxCommands: 24,
		failures: { key: 'worker-sdk-call-owner' }
	})
	expect(() =>
		assertTestCoverage(coverage, { eventTypes: 1, stateNodes: 1, transitions: 1 })
	).not.toThrow()
})
