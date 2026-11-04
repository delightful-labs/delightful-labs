import { assign, fromPromise, sendTo, setup } from 'xstate'
import type { ArchiveEnvelopeRequest } from '../../backup/envelope-operation.js'
import { createArchiveEnvelopeMachine } from './envelope.js'
import {
	buildInspectionReport,
	claimInspectionRequest,
	clearInspectionData,
	inspectSourceHeader,
	inspectionFailure,
	matchInspectionProfile,
	prepareInspectionEnvelope,
	requireInspectionValue,
	validateInspectionProfile,
	type ArchiveInspectionRequest,
	type ArchiveInspectionResult,
	type InspectionValidation
} from '../../backup/inspection.js'
import { inspectionReads, type InspectionReadEvent } from '../../backup/inspection-native.js'

export type ArchiveInspectionInput = { request: ArchiveInspectionRequest }
export type ArchiveInspectionEvent = { type: 'CANCEL' | 'SHUTDOWN' }
type Event = ArchiveInspectionEvent | InspectionReadEvent
type Context = ArchiveInspectionInput & {
	envelope: ArchiveEnvelopeRequest | undefined
	hasPassword: boolean
	protection: 'none' | 'password' | undefined
	profileIndex: number | undefined
	validation: InspectionValidation | undefined
	acquired: boolean
	interruption: 'cancelled' | 'closed' | undefined
	result: ArchiveInspectionResult | undefined
}
function leaf<T>(run: (input: ArchiveInspectionInput) => T) {
	return fromPromise<T, ArchiveInspectionInput>(({ input }) => Promise.resolve(run(input)))
}
export function createArchiveInspectionMachine() {
	const actors = {
		reads: inspectionReads,
		claim: leaf(({ request }) => claimInspectionRequest(request)),
		checkSource: leaf(({ request }) => inspectSourceHeader(request)),
		prepare: leaf(({ request }) => prepareInspectionEnvelope(request)),
		open: createArchiveEnvelopeMachine(),
		matchProfile: leaf(({ request }) => matchInspectionProfile(request)),
		inspectProfile: fromPromise<boolean, ArchiveInspectionInput & { index: number }>(({ input }) =>
			Promise.resolve(validateInspectionProfile(input.request, input.index))
		),
		buildReport: fromPromise<
			ArchiveInspectionResult,
			ArchiveInspectionInput & { protection: 'none' | 'password'; validation: InspectionValidation }
		>(({ input }) =>
			Promise.resolve({
				outcome: input.validation,
				report: buildInspectionReport(input.request, input.protection)
			})
		),
		cleanup: leaf(({ request }) => clearInspectionData(request))
	}
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ fail: undefined; revoke: undefined },
		{ interrupted: undefined },
		never,
		string,
		ArchiveInspectionInput,
		ArchiveInspectionResult
	>({
		actors,
		guards: {
			interrupted: ({ context }) =>
				context.interruption !== undefined || context.result?.outcome === 'failed'
		},
		actions: {
			fail: assign({
				result: ({ event }) =>
					'error' in event
						? inspectionFailure(event.error)
						: event.type === 'READ_FAILED'
							? event.failure
							: inspectionFailure(undefined)
			}),
			revoke: assign({ result: { outcome: 'failed', code: 'inspectionFailed' } })
		}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const fail = { target: '#archive-inspection.cleaning', actions: 'fail' } satisfies {
		target: string
		actions: 'fail'
	}
	const interrupted = { guard: 'interrupted', target: '#archive-inspection.cleaning' } satisfies {
		guard: 'interrupted'
		target: string
	}
	const advance = (target: string) => [interrupted, { target }]
	return model.createMachine({
		id: 'archive-inspection',
		initial: 'claiming',
		context: ({ input }) => ({
			request: input.request,
			envelope: undefined,
			hasPassword: false,
			protection: undefined,
			profileIndex: undefined,
			validation: undefined,
			acquired: false,
			interruption: undefined,
			result: undefined
		}),
		output: ({ context }) =>
			context.interruption
				? { outcome: context.interruption }
				: (context.result ?? { outcome: 'failed', code: 'inspectionFailed' }),
		on: {
			CANCEL: { actions: assign({ interruption: 'cancelled' }) },
			SHUTDOWN: { actions: assign({ interruption: 'closed' }) }
		},
		states: {
			claiming: {
				invoke: {
					src: 'claim',
					input,
					onError: fail,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning', actions: assign({ acquired: true }) },
						{
							target: 'working',
							actions: assign({ acquired: true, hasPassword: ({ event }) => event.output })
						}
					]
				}
			},
			working: {
				invoke: { id: 'reads', src: 'reads', input, onError: fail },
				initial: 'reading',
				on: {
					CANCEL: {
						actions: [
							assign({ interruption: 'cancelled' }),
							sendTo('reads', { type: 'ABORT_READ' })
						]
					},
					SHUTDOWN: {
						actions: [assign({ interruption: 'closed' }), sendTo('reads', { type: 'ABORT_READ' })]
					},
					RELEASE: { actions: ['revoke', sendTo('reads', { type: 'ABORT_READ' })] },
					READ_FAILED: fail
				},
				states: {
					reading: {
						entry: sendTo('reads', { type: 'READ_SOURCE' }),
						on: { SOURCE_READY: advance('checkingSource') }
					},
					checkingSource: {
						invoke: {
							src: 'checkSource',
							input,
							onError: fail,
							onDone: [
								interrupted,
								{
									guard: ({ event, context }) =>
										event.output === 'password' && !context.hasPassword,
									target: '#archive-inspection.cleaning',
									actions: assign({ result: { outcome: 'passwordRequired' } })
								},
								{
									guard: ({ event }) => event.output === 'password',
									target: 'readingPassword',
									actions: assign({ protection: ({ event }) => event.output })
								},
								{
									target: 'preparingEnvelope',
									actions: assign({ protection: ({ event }) => event.output })
								}
							]
						}
					},
					readingPassword: {
						entry: sendTo('reads', { type: 'READ_PASSWORD' }),
						on: { PASSWORD_READY: advance('preparingEnvelope') }
					},
					preparingEnvelope: {
						invoke: {
							src: 'prepare',
							input,
							onError: fail,
							onDone: [
								interrupted,
								{ target: 'opening', actions: assign({ envelope: ({ event }) => event.output }) }
							]
						}
					},
					opening: {
						on: {
							CANCEL: {
								actions: [
									assign({ interruption: 'cancelled' }),
									sendTo('envelope', { type: 'CANCEL' })
								]
							},
							SHUTDOWN: {
								actions: [
									assign({ interruption: 'closed' }),
									sendTo('envelope', { type: 'SHUTDOWN' })
								]
							},
							RELEASE: { actions: ['revoke', sendTo('envelope', { type: 'SHUTDOWN' })] }
						},
						invoke: {
							id: 'envelope',
							src: 'open',
							input: ({ context }) => ({ request: requireInspectionValue(context.envelope) }),
							onError: fail,
							onDone: [
								interrupted,
								{
									guard: ({ event }) => event.output.outcome === 'integrityChecked',
									target: 'matchingProfile'
								},
								{
									target: '#archive-inspection.cleaning',
									actions: assign({
										result: ({ event }): ArchiveInspectionResult =>
											event.output.outcome === 'failed' ||
											event.output.outcome === 'cancelled' ||
											event.output.outcome === 'closed'
												? event.output
												: { outcome: 'failed', code: 'inspectionFailed' }
									})
								}
							]
						}
					},
					matchingProfile: {
						invoke: {
							src: 'matchProfile',
							input,
							onError: fail,
							onDone: [
								interrupted,
								{
									guard: ({ event }) => event.output < 0,
									target: 'buildingReport',
									actions: assign({ validation: 'integrityValidProfileUnsupported' })
								},
								{
									target: 'inspectingProfile',
									actions: assign({ profileIndex: ({ event }) => event.output })
								}
							]
						}
					},
					inspectingProfile: {
						invoke: {
							src: 'inspectProfile',
							input: ({ context }) => ({
								request: context.request,
								index: requireInspectionValue(context.profileIndex)
							}),
							onError: fail,
							onDone: [
								interrupted,
								{
									guard: ({ event }) => event.output,
									target: 'buildingReport',
									actions: assign({ validation: 'profileValid' })
								},
								{ target: 'buildingReport', actions: assign({ validation: 'profileInvalid' }) }
							]
						}
					},
					buildingReport: {
						invoke: {
							src: 'buildReport',
							input: ({ context }) => ({
								request: context.request,
								protection: requireInspectionValue(context.protection),
								validation: requireInspectionValue(context.validation)
							}),
							onError: fail,
							onDone: [
								interrupted,
								{
									target: 'transferringReport',
									actions: assign({ result: ({ event }) => event.output })
								}
							]
						}
					},
					transferringReport: {
						entry: ({ context }) => clearInspectionData(context.request, true),
						always: '#archive-inspection.cleaning'
					}
				},
				exit: ({ context }) => clearInspectionData(context.request)
			},
			cleaning: {
				always: { guard: ({ context }) => !context.acquired, target: 'complete' },
				invoke: {
					src: 'cleanup',
					input,
					onDone: {
						target: 'complete',
						actions: ({ context }) => {
							if (context.interruption && context.result && 'report' in context.result)
								context.result.report.release()
						}
					},
					onError: {
						target: 'complete',
						actions: [
							({ context }) => {
								if (context.result && 'report' in context.result) context.result.report.release()
							},
							'fail'
						]
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
