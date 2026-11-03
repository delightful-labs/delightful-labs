import { assign, fromPromise, setup } from 'xstate'
import {
	exportFailure,
	exportOperation,
	sameBackupBinding,
	type ArchiveExportInterruption,
	type ArchiveExportResult,
	type ArchiveHandoffObservation,
	type BackupBinding
} from '../../backup/export.js'
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
		claim: fromPromise<void, ArchiveExportInput>(({ input }) => {
			exportOperation(input.request).claim()
			return Promise.resolve()
		}),
		capture: createArchiveCaptureMachine(),
		prepare: fromPromise<ArchiveEnvelopeRequest, ArchiveExportInput>(({ input }) =>
			Promise.resolve(exportOperation(input.request).prepareEnvelope())
		),
		seal: createArchiveEnvelopeMachine(),
		handoff: fromPromise<ArchiveHandoffObservation, ArchiveExportInput>(({ input }) =>
			exportOperation(input.request).dispatch()
		),
		drain: fromPromise<void, ArchiveExportInput>(({ input }) => {
			exportOperation(input.request).abort()
			return exportOperation(input.request).drainIssued()
		}),
		release: fromPromise<void, ArchiveExportInput>(({ input }) =>
			exportOperation(input.request).releaseLease()
		),
		cleanup: fromPromise<void, ArchiveExportInput>(({ input }) => {
			exportOperation(input.request).finish()
			return Promise.resolve()
		})
	}
	const model = setup<
		Context,
		ArchiveExportEvent,
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
			interrupted: ({ context }) => context.interruption !== undefined,
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
	// Ask only a currently active child to drain. A completed child cannot acknowledge shutdown.
	const forward = model.enqueueActions(({ context, event, self, enqueue }) => {
		if (!context.claimed) return
		exportOperation(context.request).abort()
		const child = self.getSnapshot().children.effect
		if (child?.getSnapshot().status !== 'active') return
		enqueue.sendTo(child, { type: event.type === 'SHUTDOWN' ? 'SHUTDOWN' : 'CANCEL' })
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
			binding: exportOperation(input.request).binding,
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
			CANCEL: { actions: ['interrupt', forward] },
			SHUTDOWN: { actions: ['interrupt', forward] },
			INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forward] }
		},
		states: {
			claiming: {
				invoke: {
					src: 'claim',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning', actions: assign({ claimed: true }) },
						{ target: 'capturing', actions: assign({ claimed: true }) }
					],
					onError: failed
				}
			},
			capturing: {
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
				tags: 'protecting',
				invoke: {
					src: 'prepare',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning' },
						{ target: 'sealing', actions: assign({ envelope: ({ event }) => event.output }) }
					],
					onError: failed
				}
			},
			sealing: {
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
							actions: assign({ archiveProduced: ({ event }) => event.output.outcome === 'sealed' })
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
				always: { guard: ({ context }) => !context.claimed, target: 'complete' },
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
				invoke: {
					src: 'cleanup',
					input,
					onDone: 'complete',
					onError: { target: 'complete', actions: 'fail' }
				}
			},
			complete: { type: 'final' }
		}
	})
}
