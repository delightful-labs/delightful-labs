import { assign, fromPromise, setup, type ActorLogic, type Snapshot } from 'xstate'
import {
	claimJazzExport,
	jazzReaderInput,
	endJazzReader,
	openJazzExport,
	validateJazzExport,
	commitJazzExport,
	confirmJazzExport,
	protectJazzExport,
	dispatchJazzExport,
	jazzExportBinding,
	jazzExportFacts,
	abortJazzExport,
	jazzExportFailure,
	jazzExportResources,
	type JazzArchiveExportRequest,
	type JazzArchiveExportResult,
	type JazzArchiveReaderInput,
	type JazzArchiveReaderResult,
	type JazzExportErrorCode
} from '../../backend/jazz/backup.js'
import { createArchiveEnvelopeMachine } from './envelope.js'
import type { ArchiveEnvelopeRequest } from '../../backup/envelope-operation.js'
import type { BackupBinding } from '../../backup/export.js'

type Input = { request: JazzArchiveExportRequest }
type Event = { type: 'CANCEL' | 'SHUTDOWN' | 'INVALIDATE' }
type Context = Input & {
	binding: BackupBinding
	interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
	failure: JazzExportErrorCode | undefined
	envelope: ArchiveEnvelopeRequest | undefined
}
export type JazzArchiveReader<ReaderSnapshot extends Snapshot<JazzArchiveReaderResult>> =
	ActorLogic<ReaderSnapshot, { type: 'CANCEL' | 'SHUTDOWN' }, JazzArchiveReaderInput>

/** Native Jazz capture: hydrate -> exclusive read -> validate -> native verdict -> seal -> handoff. */
export function createJazzArchiveExportMachine<
	ReaderSnapshot extends Snapshot<JazzArchiveReaderResult>
>(reader: JazzArchiveReader<ReaderSnapshot>) {
	function leaf<Value>(run: (request: JazzArchiveExportRequest) => Value | Promise<Value>) {
		return fromPromise<Value, Input>(({ input }) =>
			Promise.resolve().then(() => run(input.request))
		)
	}
	const actors = {
		claim: leaf(claimJazzExport),
		resources: jazzExportResources,
		reader,
		open: leaf(openJazzExport),
		validate: leaf(validateJazzExport),
		commit: leaf(commitJazzExport),
		confirm: leaf(confirmJazzExport),
		prepare: leaf(protectJazzExport),
		seal: createArchiveEnvelopeMachine(),
		handoff: leaf(dispatchJazzExport),
		cleanup: leaf((request) => request.release())
	}
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ fail: undefined },
		{},
		never,
		string,
		Input,
		JazzArchiveExportResult
	>({
		actors,
		actions: {
			fail: assign({
				failure: ({ event }) => jazzExportFailure('error' in event ? event.error : undefined)
			})
		}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const failed = { target: 'cleaning', actions: 'fail' } satisfies {
		target: string
		actions: 'fail'
	}
	const stop = model.assign({
		interruption: ({ context, event }) =>
			context.interruption ??
			(event.type === 'SHUTDOWN'
				? 'closed'
				: event.type === 'INVALIDATE'
					? 'invalidated'
					: 'cancelled')
	})
	const readerDone = (mode: JazzArchiveReaderInput['mode'], next: string) =>
		model.createStateConfig({
			exit: ({ context }) => endJazzReader(context.request),
			invoke: {
				src: 'reader',
				input: ({ context }) => jazzReaderInput(context.request, mode),
				onDone: [
					{ guard: ({ event }) => event.output?.outcome === 'ready', target: next },
					{
						guard: ({ event }) => event.output?.outcome === 'cancelled',
						target: 'cleaning',
						actions: assign({ interruption: 'cancelled' })
					},
					{
						target: 'cleaning',
						actions: assign({ failure: ({ event }) => readerFailure(event.output) })
					}
				],
				onError: failed
			}
		})
	return model.createMachine({
		id: 'jazz-archive-export',
		initial: 'claiming',
		context: ({ input }) => ({
			...input,
			binding: jazzExportBinding(input.request),
			interruption: undefined,
			failure: undefined,
			envelope: undefined
		}),
		output: ({ context }): JazzArchiveExportResult => {
			const facts = { binding: context.binding, ...jazzExportFacts(context.request) }
			if (context.failure === 'cleanupFailed')
				return { ...facts, outcome: 'failed', code: context.failure }
			if (context.interruption) return { ...facts, outcome: context.interruption }
			return context.failure
				? { ...facts, outcome: 'failed', code: context.failure }
				: { ...facts, outcome: 'exported' }
		},
		states: {
			claiming: {
				on: {
					CANCEL: { actions: stop },
					SHUTDOWN: { actions: stop },
					INVALIDATE: { actions: stop }
				},
				invoke: {
					src: 'claim',
					input,
					onDone: [
						{
							guard: ({ context }) => context.interruption !== undefined,
							target: 'working.cleaning'
						},
						{ target: 'working' }
					],
					onError: { target: 'complete', actions: 'fail' }
				}
			},
			working: {
				initial: 'hydrating',
				invoke: {
					src: 'resources',
					input: ({ context, self }) => ({ request: context.request, owner: self }),
					onError: { target: '.cleaning', actions: 'fail' }
				},
				on: {
					CANCEL: { target: '.cleaning', actions: stop },
					SHUTDOWN: { target: '.cleaning', actions: stop },
					INVALIDATE: { target: '.cleaning', actions: stop }
				},
				states: {
					hydrating: readerDone('hydrate', 'opening'),
					opening: { invoke: { src: 'open', input, onDone: 'reading', onError: failed } },
					reading: readerDone('capture', 'validating'),
					validating: { invoke: { src: 'validate', input, onDone: 'committing', onError: failed } },
					committing: { invoke: { src: 'commit', input, onDone: 'confirming', onError: failed } },
					confirming: { invoke: { src: 'confirm', input, onDone: 'preparing', onError: failed } },
					preparing: {
						invoke: {
							src: 'prepare',
							input,
							onDone: {
								target: 'protecting',
								actions: assign({ envelope: ({ event }) => event.output })
							},
							onError: failed
						}
					},
					protecting: {
						invoke: {
							src: 'seal',
							input: ({ context }) => {
								if (!context.envelope) throw new Error('Missing protection request')
								return { request: context.envelope }
							},
							onDone: [
								{
									guard: ({ event }) => event.output.outcome === 'sealed',
									target: 'handingOff'
								},
								{ target: 'cleaning', actions: assign({ failure: 'failed' }) }
							],
							onError: failed
						}
					},
					handingOff: {
						invoke: {
							src: 'handoff',
							input,
							onDone: {
								target: 'cleaning',
								actions: assign({
									failure: ({ event }) => (event.output === 'dispatched' ? undefined : 'failed')
								})
							},
							onError: failed
						}
					},
					cleaning: {
						on: { CANCEL: {}, SHUTDOWN: {}, INVALIDATE: {} },
						entry: ({ context }) => abortJazzExport(context.request),
						invoke: {
							src: 'cleanup',
							input,
							onDone: '#jazz-archive-export.complete',
							onError: {
								target: '#jazz-archive-export.complete',
								actions: assign({ failure: 'cleanupFailed' })
							}
						}
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
function readerFailure(output: JazzArchiveReaderResult | undefined): JazzExportErrorCode {
	return output?.outcome === 'failed' ? output.code : 'failed'
}
