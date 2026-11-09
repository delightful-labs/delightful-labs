import { types, setup } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
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
export type ArchiveInspectionInput = {
	request: ArchiveInspectionRequest
}
export type ArchiveInspectionEvent = {
	type: 'CANCEL' | 'SHUTDOWN'
}
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
	| {
			type: 'SYNC_COMPLETED'
			patch: Partial<Context>
	  }
	| {
			type: 'SYNC_APPLIED'
	  }
export function createArchiveInspectionMachine() {
	const actors = { reads: inspectionReads, open: createArchiveEnvelopeMachine() }
	const patches = {
		fail: ({
			event
		}: {
			context: Context
			event:
				| Event
				| {
						type: 'xstate.error.actor'
						error: unknown
				  }
		}): Partial<Context> => ({
			result:
				'error' in event
					? inspectionFailure(event.error)
					: event.type === 'READ_FAILED'
						? event.failure
						: inspectionFailure(undefined)
		}),
		revoke: (_args: { context: Context }): Partial<Context> => ({
			result: { outcome: 'failed', code: 'inspectionFailed' }
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				RELEASE: types<EventPayload<Event, 'RELEASE'>>(),
				SOURCE_READY: types<EventPayload<Event, 'SOURCE_READY'>>(),
				PASSWORD_READY: types<EventPayload<Event, 'PASSWORD_READY'>>(),
				READ_FAILED: types<EventPayload<Event, 'READ_FAILED'>>(),
				SYNC_COMPLETED: types<EventPayload<Event, 'SYNC_COMPLETED'>>()
			},
			internalEvents: { SYNC_APPLIED: types<EventPayload<Event, 'SYNC_APPLIED'>>() },
			input: types<ArchiveInspectionInput>(),
			output: types<ArchiveInspectionResult>()
		},
		actors,
		guards: {
			interrupted: ({ context }: { context: Context }) =>
				context.interruption !== undefined || context.result?.outcome === 'failed'
		},
		actions: {}
	})
	const synchronous = (run: (context: Context) => Partial<Context>) =>
		model.createStateConfig({
			entry: ({ context, self }, enq) => {
				enq(() => {
					try {
						self.send({ type: 'SYNC_COMPLETED', patch: run(context) })
					} catch (error) {
						self.send({ type: 'SYNC_COMPLETED', patch: { result: inspectionFailure(error) } })
					}
				})
			}
		}).entry
	const input = ({ context }: { context: Context }) => ({ request: context.request })
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
			SYNC_COMPLETED: (args, enq) => {
				const { event } = args
				enq.raise({ type: 'SYNC_APPLIED' })
				return {
					context: (event.type === 'SYNC_COMPLETED' ? event.patch : {}) satisfies Partial<Context>
				}
			},
			CANCEL: (_args) => {
				return { context: { interruption: 'cancelled' } satisfies Partial<Context> }
			},
			SHUTDOWN: (_args) => {
				return { context: { interruption: 'closed' } satisfies Partial<Context> }
			}
		},
		states: {
			claiming: {
				entry: synchronous(({ request }) => ({
					acquired: true,
					hasPassword: claimInspectionRequest(request)
				})),
				on: {
					SYNC_APPLIED: (args) => {
						if (!args.context.acquired) {
							return { target: 'complete' }
						}
						if (args.guards.interrupted(args)) {
							return { target: 'cleaning' }
						}
						return { target: 'working' }
					}
				}
			},
			working: {
				invoke: {
					id: 'reads',
					src: actors.reads,
					input,
					onError: (args) => {
						return {
							target: '#archive-inspection.cleaning',
							context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
						}
					}
				},
				initial: 'reading',
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('reads', { type: 'ABORT_READ' })
						return {
							context: { interruption: 'cancelled' } satisfies Partial<Context>
						}
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('reads', { type: 'ABORT_READ' })
						return { context: { interruption: 'closed' } satisfies Partial<Context> }
					},
					RELEASE: (args, enq) => {
						enq.sendTo('reads', { type: 'ABORT_READ' })
						return { context: patches.revoke(args) satisfies Partial<Context> }
					},
					READ_FAILED: (args) => {
						return {
							target: '#archive-inspection.cleaning',
							context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
						}
					}
				},
				states: {
					reading: {
						entry: (args, enq) => {
							enq.sendTo('reads', { type: 'READ_SOURCE' })
						},
						on: {
							SOURCE_READY: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#archive-inspection.cleaning' }
								}
								return { target: 'checkingSource' }
							}
						}
					},
					checkingSource: {
						entry: synchronous(({ request }) => ({ protection: inspectSourceHeader(request) })),
						on: {
							SYNC_APPLIED: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return { target: '#archive-inspection.cleaning' }
								}
								if (context.protection === 'password' && !context.hasPassword) {
									return {
										target: '#archive-inspection.cleaning',
										context: { result: { outcome: 'passwordRequired' } } satisfies Partial<Context>
									}
								}
								if (context.protection === 'password') {
									return { target: 'readingPassword' }
								}
								return { target: 'preparingEnvelope' }
							}
						}
					},
					readingPassword: {
						entry: (args, enq) => {
							enq.sendTo('reads', { type: 'READ_PASSWORD' })
						},
						on: {
							PASSWORD_READY: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#archive-inspection.cleaning' }
								}
								return { target: 'preparingEnvelope' }
							}
						}
					},
					preparingEnvelope: {
						entry: synchronous(({ request }) => ({ envelope: prepareInspectionEnvelope(request) })),
						on: {
							SYNC_APPLIED: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#archive-inspection.cleaning' }
								}
								return { target: 'opening' }
							}
						}
					},
					opening: {
						on: {
							CANCEL: (args, enq) => {
								enq.sendTo('envelope', { type: 'CANCEL' })
								return {
									context: { interruption: 'cancelled' } satisfies Partial<Context>
								}
							},
							SHUTDOWN: (args, enq) => {
								enq.sendTo('envelope', { type: 'SHUTDOWN' })
								return {
									context: { interruption: 'closed' } satisfies Partial<Context>
								}
							},
							RELEASE: (args, enq) => {
								enq.sendTo('envelope', { type: 'SHUTDOWN' })
								return { context: patches.revoke(args) satisfies Partial<Context> }
							}
						},
						invoke: {
							id: 'envelope',
							src: actors.open,
							input: ({ context }) => ({ request: requireInspectionValue(context.envelope) }),
							onError: (args) => {
								return {
									target: '#archive-inspection.cleaning',
									context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
								}
							},
							onDone: (args) => {
								const { event } = args
								if (args.guards.interrupted(args)) {
									return { target: '#archive-inspection.cleaning' }
								}
								if (event.output.outcome === 'integrityChecked') {
									return { target: 'matchingProfile' }
								}
								return {
									target: '#archive-inspection.cleaning',
									context: {
										result:
											event.output.outcome === 'failed' ||
											event.output.outcome === 'cancelled' ||
											event.output.outcome === 'closed'
												? event.output
												: { outcome: 'failed', code: 'inspectionFailed' }
									} satisfies Partial<Context>
								}
							}
						}
					},
					matchingProfile: {
						entry: synchronous(({ request }) => ({
							profileIndex: matchInspectionProfile(request)
						})),
						on: {
							SYNC_APPLIED: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return { target: '#archive-inspection.cleaning' }
								}
								if (context.profileIndex !== undefined && context.profileIndex < 0) {
									return {
										target: 'buildingReport',
										context: {
											validation: 'integrityValidProfileUnsupported'
										} satisfies Partial<Context>
									}
								}
								return { target: 'inspectingProfile' }
							}
						}
					},
					inspectingProfile: {
						entry: synchronous(({ request, profileIndex }) => ({
							validation: validateInspectionProfile(request, requireInspectionValue(profileIndex))
								? 'profileValid'
								: 'profileInvalid'
						})),
						on: {
							SYNC_APPLIED: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#archive-inspection.cleaning' }
								}
								return { target: 'buildingReport' }
							}
						}
					},
					buildingReport: {
						entry: synchronous(({ request, protection, validation }) => ({
							result: {
								outcome: requireInspectionValue(validation),
								report: buildInspectionReport(request, requireInspectionValue(protection))
							}
						})),
						on: {
							SYNC_APPLIED: (args) => {
								if (args.guards.interrupted(args)) {
									return { target: '#archive-inspection.cleaning' }
								}
								return { target: 'transferringReport' }
							}
						}
					},
					transferringReport: {
						entry: ({ context }, enq) => {
							enq(() => clearInspectionData(context.request, true))
						},
						always: { target: '#archive-inspection.cleaning' }
					}
				},
				exit: ({ context }, enq) => {
					enq(() => clearInspectionData(context.request))
				}
			},
			cleaning: {
				entry: synchronous((context) => {
					if (context.acquired) clearInspectionData(context.request)
					if (context.interruption && context.result && 'report' in context.result)
						context.result.report.release()
					return {}
				}),
				on: { SYNC_APPLIED: { target: 'complete' } }
			},
			complete: { type: 'final' }
		}
	})
}
