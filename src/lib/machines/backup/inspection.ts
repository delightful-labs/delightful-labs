import { assign, fromPromise, sendTo, setup } from 'xstate'
import type { ArchiveEnvelopeRequest } from '../../backup/envelope-operation.js'
import { createArchiveEnvelopeMachine } from './envelope.js'
import {
	inspectionFailure,
	inspectionOperation,
	type ArchiveInspectionRequest,
	type ArchiveInspectionResult
} from '../../backup/inspection.js'

export type ArchiveInspectionInput = { request: ArchiveInspectionRequest }
export type ArchiveInspectionEvent = { type: 'CANCEL' | 'SHUTDOWN' }
type Context = ArchiveInspectionInput & {
	envelope: ArchiveEnvelopeRequest | undefined
	acquired: boolean
	interruption: 'cancelled' | 'closed' | undefined
	result: ArchiveInspectionResult | undefined
}
function leaf<T>(run: (operation: ReturnType<typeof inspectionOperation>) => T | PromiseLike<T>) {
	return fromPromise<T, ArchiveInspectionInput>(({ input }) =>
		Promise.resolve(run(inspectionOperation(input.request)))
	)
}
export function createArchiveInspectionMachine() {
	const actors = {
		claim: leaf((operation) => operation.claim()),
		read: leaf((operation) => operation.readSource()),
		password: leaf((operation) => operation.readPassword()),
		prepare: leaf((operation) => operation.prepareEnvelope()),
		open: createArchiveEnvelopeMachine(),
		inspectProfile: leaf((operation) => operation.inspectProfile()),
		cleanup: fromPromise<void, ArchiveInspectionInput & { keepReport: boolean }>(({ input }) => {
			inspectionOperation(input.request).cleanup(input.keepReport)
			return Promise.resolve()
		})
	}
	const model = setup<
		Context,
		ArchiveInspectionEvent,
		typeof actors,
		{},
		{ fail: undefined; cancelRead: undefined },
		{ interrupted: undefined },
		never,
		string,
		ArchiveInspectionInput,
		ArchiveInspectionResult
	>({
		actors,
		guards: { interrupted: ({ context }) => context.interruption !== undefined },
		actions: {
			fail: assign({
				result: ({ event }): ArchiveInspectionResult =>
					'error' in event
						? inspectionFailure(event.error)
						: { outcome: 'failed', code: 'inspectionFailed' }
			}),
			cancelRead: ({ context }) => {
				if (context.acquired) inspectionOperation(context.request).abortRead()
			}
		}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const fail = { target: 'cleaning', actions: 'fail' } satisfies { target: string; actions: 'fail' }
	return model.createMachine({
		id: 'archive-inspection',
		initial: 'claiming',
		context: ({ input }) => ({
			request: input.request,
			envelope: undefined,
			acquired: false,
			interruption: undefined,
			result: undefined
		}),
		output: ({ context }) =>
			context.interruption
				? { outcome: context.interruption }
				: (context.result ?? { outcome: 'failed', code: 'inspectionFailed' }),
		on: {
			CANCEL: { actions: [assign({ interruption: 'cancelled' }), 'cancelRead'] },
			SHUTDOWN: { actions: [assign({ interruption: 'closed' }), 'cancelRead'] }
		},
		states: {
			claiming: {
				invoke: {
					src: 'claim',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning', actions: assign({ acquired: true }) },
						{ target: 'reading', actions: assign({ acquired: true }) }
					],
					onError: fail
				}
			},
			reading: {
				invoke: {
					src: 'read',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning' },
						{
							guard: ({ event }) => event.output === 'passwordRequired',
							target: 'cleaning',
							actions: assign({
								result: (): ArchiveInspectionResult => ({ outcome: 'passwordRequired' })
							})
						},
						{ guard: ({ event }) => event.output === 'password', target: 'readingPassword' },
						{ target: 'preparingEnvelope' }
					],
					onError: fail
				}
			},
			readingPassword: {
				invoke: {
					src: 'password',
					input,
					onDone: [{ guard: 'interrupted', target: 'cleaning' }, { target: 'preparingEnvelope' }],
					onError: fail
				}
			},
			preparingEnvelope: {
				invoke: {
					src: 'prepare',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning' },
						{ target: 'opening', actions: assign({ envelope: ({ event }) => event.output }) }
					],
					onError: fail
				}
			},

			opening: {
				on: {
					CANCEL: {
						actions: [assign({ interruption: 'cancelled' }), sendTo('envelope', { type: 'CANCEL' })]
					},
					SHUTDOWN: {
						actions: [assign({ interruption: 'closed' }), sendTo('envelope', { type: 'SHUTDOWN' })]
					}
				},
				invoke: {
					id: 'envelope',
					src: 'open',
					input: ({ context }) => {
						if (!context.envelope) throw new Error('Missing prepared envelope request')
						return { request: context.envelope }
					},
					onDone: [
						{
							guard: 'interrupted',
							target: 'cleaning'
						},
						{
							guard: ({ event }) => event.output.outcome === 'integrityChecked',
							target: 'inspectingProfile'
						},
						{
							target: 'cleaning',
							actions: assign({
								result: ({ event }): ArchiveInspectionResult =>
									event.output.outcome === 'failed' ||
									event.output.outcome === 'cancelled' ||
									event.output.outcome === 'closed'
										? event.output
										: { outcome: 'failed', code: 'inspectionFailed' }
							})
						}
					],
					onError: fail
				}
			},
			inspectingProfile: {
				invoke: {
					src: 'inspectProfile',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning' },
						{ target: 'cleaning', actions: assign({ result: ({ event }) => event.output }) }
					],
					onError: fail
				}
			},
			cleaning: {
				always: { guard: ({ context }) => !context.acquired, target: 'complete' },
				invoke: {
					src: 'cleanup',
					input: ({ context }) => ({
						request: context.request,
						keepReport:
							context.interruption === undefined &&
							context.result !== undefined &&
							'report' in context.result
					}),
					onDone: {
						target: 'complete',
						actions: assign({
							result: ({ context }): ArchiveInspectionResult => {
								if (context.interruption) {
									if (context.result && 'report' in context.result) context.result.report.release()
									return { outcome: context.interruption }
								}
								return context.result ?? { outcome: 'failed', code: 'inspectionFailed' }
							}
						})
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
