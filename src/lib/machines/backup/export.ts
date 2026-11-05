import { sendTo, raise, assign, fromPromise, setup } from 'xstate'
import {
	exportFailure,
	exportData,
	claimExportRequest,
	prepareExportEnvelope,
	sameBackupBinding,
	type ArchiveExportInterruption,
	type ArchiveExportResult,
	type ArchiveHandoffObservation,
	type BackupBinding
} from '../../backup/export.js'
import {
	abortExport,
	dispatchExportFile,
	drainExport,
	finishExport,
	releaseExportLease,
	exportResources
} from '../../backup/export-native.js'
export { createArchiveExportCleanupMachine } from './export-cleanup.js'
import type { ArchiveEnvelopeRequest } from '../../backup/envelope-operation.js'
import { createArchiveEnvelopeMachine } from './envelope.js'
import {
	createArchiveCaptureMachine,
	type ArchiveExportEvent,
	type ArchiveExportInput
} from './capture.js'
export type { ArchiveExportEvent, ArchiveExportInput } from './capture.js'

type Context = ArchiveExportInput & {
	binding: BackupBinding
	claimed: boolean
	envelope: ArchiveEnvelopeRequest | undefined
	interruption: ArchiveExportInterruption | undefined
	failure: ReturnType<typeof exportFailure> | undefined
	archiveProduced: boolean
	handoff: ArchiveHandoffObservation | 'notStarted'
}

type SynchronousEvent =
	| { type: 'SYNC_COMPLETED'; patch: Partial<Context> }
	| { type: 'SYNC_APPLIED' }
function mergeHandoff(
	previous: Context['handoff'],
	observation: ArchiveHandoffObservation
): ArchiveHandoffObservation {
	if (previous === 'dispatched' || observation === 'dispatched') return 'dispatched'
	if (previous === 'unknown' || observation === 'unknown') return 'unknown'
	return observation
}

/** One export per request. Drain via CANCEL/SHUTDOWN before stopping the actor. */
export function createArchiveExportMachine() {
	const actors = {
		resources: exportResources,
		capture: createArchiveCaptureMachine(),
		seal: createArchiveEnvelopeMachine(),
		handoff: fromPromise<ArchiveHandoffObservation, ArchiveExportInput>(({ input }) =>
			dispatchExportFile(input.request)
		),
		drain: fromPromise<void, ArchiveExportInput>(({ input }) => {
			abortExport(input.request)
			return drainExport(input.request)
		}),
		release: fromPromise<void, ArchiveExportInput>(({ input }) => releaseExportLease(input.request))
	}
	const model = setup<
		Context,
		ArchiveExportEvent | { type: 'RELEASE' } | SynchronousEvent,
		typeof actors,
		{},
		{ fail: undefined; interrupt: undefined },
		{ interrupted: undefined; currentBinding: undefined },
		never,
		string,
		ArchiveExportInput,
		ArchiveExportResult
	>({
		actors,
		guards: {
			interrupted: ({ context }) =>
				context.interruption !== undefined || context.failure !== undefined,
			currentBinding: ({ context, event }) =>
				(event.type === 'INVALIDATE' || event.type === 'RETRY_HANDOFF') &&
				sameBackupBinding(context.binding, event.binding)
		},
		actions: {
			fail: assign({
				failure: ({ event }) => exportFailure('error' in event ? event.error : undefined)
			}),
			interrupt: assign({
				interruption: ({ context, event }) =>
					context.interruption ??
					(event.type === 'SHUTDOWN'
						? 'closed'
						: event.type === 'INVALIDATE'
							? 'invalidated'
							: 'cancelled')
			})
		}
	})
	// Abort the host leaf only after this actor has claimed its request. Child commands are state-scoped.
	const abort = model.createAction(({ context }) => {
		if (context.claimed) abortExport(context.request)
	})

	const synchronous = (run: (context: Context) => Partial<Context>) =>
		model.createAction(({ context, self }) => {
			try {
				self.send({ type: 'SYNC_COMPLETED', patch: run(context) })
			} catch (error) {
				self.send({ type: 'SYNC_COMPLETED', patch: { failure: exportFailure(error) } })
			}
		})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const failed = { target: 'cleaning', actions: 'fail' } satisfies {
		target: string
		actions: 'fail'
	}
	return model.createMachine({
		id: 'archive-export',
		initial: 'claiming',
		context: ({ input }) => ({
			request: input.request,
			binding: exportData(input.request).binding,
			claimed: false,
			envelope: undefined,
			interruption: undefined,
			failure: undefined,
			archiveProduced: false,
			handoff: 'notStarted'
		}),
		output: ({ context }): ArchiveExportResult => {
			const facts = {
				binding: context.binding,
				archiveProduced: context.archiveProduced,
				handoff: context.handoff
			}
			if (context.failure?.code === 'captureCleanupFailed') return { ...facts, ...context.failure }
			if (context.interruption) return { ...facts, outcome: context.interruption }
			if (context.failure) return { ...facts, ...context.failure }
			return { ...facts, outcome: 'exported' }
		},
		on: {
			SYNC_COMPLETED: {
				actions: [
					model.assign(({ event }) => (event.type === 'SYNC_COMPLETED' ? event.patch : {})),
					raise({ type: 'SYNC_APPLIED' })
				]
			},
			CANCEL: { actions: ['interrupt', abort] },
			SHUTDOWN: { actions: ['interrupt', abort] },
			INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', abort] },
			RELEASE: {
				actions: [assign({ failure: { outcome: 'failed', code: 'exportReleased' } }), abort]
			}
		},
		states: {
			claiming: {
				entry: synchronous(({ request }) => {
					claimExportRequest(request)
					return { claimed: true }
				}),
				on: {
					SYNC_APPLIED: [
						{ guard: ({ context }) => !context.claimed, target: 'complete' },
						{ guard: 'interrupted', target: 'working.cleaning' },
						{ target: 'working' }
					]
				}
			},
			working: {
				initial: 'capturing',
				invoke: { src: 'resources', input, onError: { target: '.cleaning', actions: 'fail' } },
				states: {
					capturing: {
						on: {
							CANCEL: { actions: ['interrupt', abort, sendTo('effect', { type: 'CANCEL' })] },
							SHUTDOWN: { actions: ['interrupt', abort, sendTo('effect', { type: 'SHUTDOWN' })] },
							INVALIDATE: {
								guard: 'currentBinding',
								actions: ['interrupt', abort, sendTo('effect', { type: 'CANCEL' })]
							},
							RELEASE: {
								actions: [
									assign({ failure: { outcome: 'failed', code: 'exportReleased' } }),
									abort,
									sendTo('effect', { type: 'CANCEL' })
								]
							}
						},

						tags: 'capturing',
						invoke: {
							id: 'effect',
							src: 'capture',
							input,
							onDone: [
								{
									guard: ({ event }) => event.output.outcome === 'failed',
									target: 'cleaning',
									actions: assign({
										failure: ({ event }) =>
											event.output.outcome === 'failed' ? event.output : undefined
									})
								},
								{ guard: 'interrupted', target: 'cleaning' },
								{ guard: ({ event }) => event.output.outcome === 'captured', target: 'preparing' },
								{
									target: 'cleaning',
									actions: assign({
										interruption: ({ event }) =>
											event.output.outcome === 'captured' || event.output.outcome === 'failed'
												? undefined
												: event.output.outcome
									})
								}
							],
							onError: failed
						}
					},
					preparing: {
						entry: synchronous(({ request }) => ({ envelope: prepareExportEnvelope(request) })),
						on: {
							SYNC_APPLIED: [{ guard: 'interrupted', target: 'cleaning' }, { target: 'sealing' }]
						}
					},
					sealing: {
						on: {
							CANCEL: { actions: ['interrupt', abort, sendTo('effect', { type: 'CANCEL' })] },
							SHUTDOWN: { actions: ['interrupt', abort, sendTo('effect', { type: 'SHUTDOWN' })] },
							INVALIDATE: {
								guard: 'currentBinding',
								actions: ['interrupt', abort, sendTo('effect', { type: 'CANCEL' })]
							},
							RELEASE: {
								actions: [
									assign({ failure: { outcome: 'failed', code: 'exportReleased' } }),
									abort,
									sendTo('effect', { type: 'CANCEL' })
								]
							}
						},

						always: {
							guard: ({ context }) => context.envelope === undefined,
							target: 'cleaning',
							actions: assign({ failure: exportFailure(undefined) })
						},
						tags: 'protecting',
						invoke: {
							id: 'effect',
							src: 'seal',
							input: ({ context }) => {
								if (!context.envelope) throw new Error('Missing export envelope request')
								return { request: context.envelope }
							},
							onDone: [
								{
									guard: 'interrupted',
									target: 'cleaning',
									actions: assign({
										archiveProduced: ({ event }) => event.output.outcome === 'sealed'
									})
								},
								{
									guard: ({ event }) => event.output.outcome === 'sealed',
									target: 'handingOff',
									actions: assign({ archiveProduced: true })
								},
								{
									target: 'cleaning',
									actions: assign({
										failure: ({ event }) =>
											event.output.outcome === 'failed' ? event.output : exportFailure(undefined)
									})
								}
							],
							onError: failed
						}
					},
					handingOff: {
						tags: 'handingOff',
						invoke: {
							src: 'handoff',
							input,
							onDone: [
								{
									guard: 'interrupted',
									target: 'cleaning',
									actions: assign({
										handoff: ({ context, event }) => mergeHandoff(context.handoff, event.output)
									})
								},
								{
									guard: ({ event }) => event.output === 'dispatched',
									target: 'cleaning',
									actions: assign({
										handoff: ({ context, event }) => mergeHandoff(context.handoff, event.output)
									})
								},
								{
									target: 'handoffRetry',
									actions: assign({
										handoff: ({ context, event }) => mergeHandoff(context.handoff, event.output)
									})
								}
							],
							onError: failed
						}
					},
					handoffRetry: {
						tags: 'handoffRetry',
						always: { guard: 'interrupted', target: 'cleaning' },
						on: { RETRY_HANDOFF: { guard: 'currentBinding', target: 'handingOff' } }
					},
					cleaning: {
						tags: 'cleaning',
						always: {
							guard: ({ context }) => !context.claimed,
							target: '#archive-export.complete'
						},
						invoke: {
							src: 'drain',
							input,
							onDone: 'releasing',
							onError: { target: 'clearing', actions: 'fail' }
						}
					},
					releasing: {
						tags: 'cleaning',
						always: {
							guard: ({ context }) => context.failure?.code === 'captureCleanupFailed',
							target: 'clearing'
						},
						invoke: {
							src: 'release',
							input,
							onDone: 'clearing',
							onError: { target: 'clearing', actions: 'fail' }
						}
					},
					clearing: {
						tags: 'cleaning',
						entry: synchronous(({ request }) => {
							finishExport(request)
							return {}
						}),
						on: { SYNC_APPLIED: '#archive-export.complete' }
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
