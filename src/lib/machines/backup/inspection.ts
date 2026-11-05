import { raise, assign, sendTo, setup } from 'xstate'
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
type Event = ArchiveInspectionEvent | InspectionReadEvent | SynchronousEvent
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
type SynchronousEvent =
	| { type: 'SYNC_COMPLETED'; patch: Partial<Context> }
	| { type: 'SYNC_APPLIED' }
export function createArchiveInspectionMachine() {
	const actors = { reads: inspectionReads, open: createArchiveEnvelopeMachine() }
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
	const synchronous = (run: (context: Context) => Partial<Context>) =>
		model.createAction(({ context, self }) => {
			try {
				self.send({ type: 'SYNC_COMPLETED', patch: run(context) })
			} catch (error) {
				self.send({ type: 'SYNC_COMPLETED', patch: { result: inspectionFailure(error) } })
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
			SYNC_COMPLETED: {
				actions: [
					model.assign(({ event }) => (event.type === 'SYNC_COMPLETED' ? event.patch : {})),
					raise({ type: 'SYNC_APPLIED' })
				]
			},
			CANCEL: { actions: assign({ interruption: 'cancelled' }) },
			SHUTDOWN: { actions: assign({ interruption: 'closed' }) }
		},
		states: {
			claiming: {
				entry: synchronous(({ request }) => ({
					acquired: true,
					hasPassword: claimInspectionRequest(request)
				})),
				on: {
					SYNC_APPLIED: [
						{ guard: ({ context }) => !context.acquired, target: 'complete' },
						{ guard: 'interrupted', target: 'cleaning' },
						{ target: 'working' }
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
						entry: synchronous(({ request }) => ({ protection: inspectSourceHeader(request) })),
						on: {
							SYNC_APPLIED: [
								interrupted,
								{
									guard: ({ context }) => context.protection === 'password' && !context.hasPassword,
									target: '#archive-inspection.cleaning',
									actions: assign({ result: { outcome: 'passwordRequired' } })
								},
								{
									guard: ({ context }) => context.protection === 'password',
									target: 'readingPassword'
								},
								{ target: 'preparingEnvelope' }
							]
						}
					},
					readingPassword: {
						entry: sendTo('reads', { type: 'READ_PASSWORD' }),
						on: { PASSWORD_READY: advance('preparingEnvelope') }
					},
					preparingEnvelope: {
						entry: synchronous(({ request }) => ({ envelope: prepareInspectionEnvelope(request) })),
						on: { SYNC_APPLIED: advance('opening') }
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
						entry: synchronous(({ request }) => ({
							profileIndex: matchInspectionProfile(request)
						})),
						on: {
							SYNC_APPLIED: [
								interrupted,
								{
									guard: ({ context }) =>
										context.profileIndex !== undefined && context.profileIndex < 0,
									target: 'buildingReport',
									actions: assign({ validation: 'integrityValidProfileUnsupported' })
								},
								{ target: 'inspectingProfile' }
							]
						}
					},
					inspectingProfile: {
						entry: synchronous(({ request, profileIndex }) => ({
							validation: validateInspectionProfile(request, requireInspectionValue(profileIndex))
								? 'profileValid'
								: 'profileInvalid'
						})),
						on: { SYNC_APPLIED: advance('buildingReport') }
					},
					buildingReport: {
						entry: synchronous(({ request, protection, validation }) => ({
							result: {
								outcome: requireInspectionValue(validation),
								report: buildInspectionReport(request, requireInspectionValue(protection))
							}
						})),
						on: { SYNC_APPLIED: advance('transferringReport') }
					},
					transferringReport: {
						entry: ({ context }) => clearInspectionData(context.request, true),
						always: '#archive-inspection.cleaning'
					}
				},
				exit: ({ context }) => clearInspectionData(context.request)
			},
			cleaning: {
				entry: synchronous((context) => {
					if (context.acquired) clearInspectionData(context.request)
					if (context.interruption && context.result && 'report' in context.result)
						context.result.report.release()
					return {}
				}),
				on: { SYNC_APPLIED: 'complete' }
			},
			complete: { type: 'final' }
		}
	})
}
