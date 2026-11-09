import { types, createAsyncLogic, setup, type Snapshot } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import {
	claimJazzExport,
	openJazzExport,
	prepareJazzExportPayload,
	validateJazzExportPayload,
	commitJazzExport,
	confirmJazzExport,
	protectJazzExport,
	requestJazzExportHandoff,
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
import { createJazzArchiveReaderMachine, type JazzArchiveReader } from './reader.js'
export type { JazzArchiveReader } from './reader.js'
import type { ArchiveEnvelopeRequest } from '../../backup/envelope-operation.js'
import type { BackupBinding } from '../../backup/binding.js'
type Input = {
	request: JazzArchiveExportRequest
}
type Event = {
	type: 'CANCEL' | 'SHUTDOWN' | 'INVALIDATE'
}
type Context = Input & {
	binding: BackupBinding
	interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
	failure: JazzExportErrorCode | undefined
	envelope: ArchiveEnvelopeRequest | undefined
}
/** Native Jazz capture: hydrate -> exclusive read -> validate -> native verdict -> seal -> handoff. */
export function createJazzArchiveExportMachine<
	ReaderSnapshot extends Snapshot<JazzArchiveReaderResult>
>(reader: JazzArchiveReader<ReaderSnapshot>) {
	function leaf<Value>(run: (request: JazzArchiveExportRequest) => Value | Promise<Value>) {
		return createAsyncLogic<Value, Input>({
			run: ({ input }) => Promise.resolve().then(() => run(input.request))
		})
	}
	const actors = {
		claim: leaf(claimJazzExport),
		resources: jazzExportResources,
		reader: createJazzArchiveReaderMachine(reader),
		open: leaf(openJazzExport),
		preparePayload: leaf(prepareJazzExportPayload),
		validate: leaf(validateJazzExportPayload),
		commit: leaf(commitJazzExport),
		confirm: leaf(confirmJazzExport),
		prepare: leaf(protectJazzExport),
		seal: createArchiveEnvelopeMachine(),
		handoff: leaf(requestJazzExportHandoff),
		cleanup: leaf((request) => request.release())
	}
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
			failure: jazzExportFailure('error' in event ? event.error : undefined)
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>()
			},
			input: types<Input>(),
			output: types<JazzArchiveExportResult>()
		},
		actors,
		actions: {}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const abort = ({ context }: { context: Context }) => abortJazzExport(context.request)
	const readerDone = (mode: JazzArchiveReaderInput['mode'], next: string) =>
		model.createStateConfig({
			invoke: {
				src: actors.reader,
				input: ({ context }) => ({ request: context.request, mode }),
				onDone: (args) => {
					const { event } = args
					if (event.output?.outcome === 'ready') {
						return { target: next }
					}
					if (event.output?.outcome === 'cancelled') {
						return {
							target: 'cleaning',
							context: { interruption: 'cancelled' } satisfies Partial<Context>
						}
					}
					return {
						target: 'cleaning',
						context: { failure: readerFailure(event.output) } satisfies Partial<Context>
					}
				},
				onError: (args) => {
					return {
						target: 'cleaning',
						context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
					}
				}
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
					CANCEL: (args) => {
						const { event: _event } = args
						return {
							context: {
								interruption: args.context.interruption ?? 'cancelled'
							} satisfies Partial<Context>
						}
					},
					SHUTDOWN: (args) => {
						const { event: _event } = args
						return {
							context: {
								interruption: args.context.interruption ?? 'closed'
							} satisfies Partial<Context>
						}
					},
					INVALIDATE: (args) => {
						const { event: _event } = args
						return {
							context: {
								interruption: args.context.interruption ?? 'invalidated'
							} satisfies Partial<Context>
						}
					}
				},
				invoke: {
					src: actors.claim,
					input,
					onDone: (args) => {
						if (!args.event.output) {
							return {
								target: 'complete',
								context: { failure: 'inUse' } satisfies Partial<Context>
							}
						}
						if (args.context.interruption !== undefined) {
							return { target: 'working.cleaning' }
						}
						return { target: 'working' }
					},
					onError: (args) => {
						return {
							target: 'complete',
							context: patches.fail(args) satisfies Partial<Context>
						}
					}
				}
			},
			working: {
				initial: 'hydrating',
				invoke: {
					src: actors.resources,
					input: ({ context, self }) => ({ request: context.request, owner: self }),
					onError: (args) => {
						return {
							target: '.cleaning',
							context: patches.fail(args) satisfies Partial<Context>
						}
					}
				},
				on: {
					CANCEL: (args) => {
						const { event: _event } = args
						return {
							target: '.cleaning',
							context: {
								interruption: args.context.interruption ?? 'cancelled'
							} satisfies Partial<Context>
						}
					},
					SHUTDOWN: (args) => {
						const { event: _event } = args
						return {
							target: '.cleaning',
							context: {
								interruption: args.context.interruption ?? 'closed'
							} satisfies Partial<Context>
						}
					},
					INVALIDATE: (args) => {
						const { event: _event } = args
						return {
							target: '.cleaning',
							context: {
								interruption: args.context.interruption ?? 'invalidated'
							} satisfies Partial<Context>
						}
					}
				},
				states: {
					hydrating: readerDone('hydrate', 'opening'),
					opening: {
						invoke: {
							src: actors.open,
							input,
							onDone: { target: 'reading' },
							onError: (args) => {
								return {
									target: 'cleaning',
									context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
								}
							}
						}
					},
					reading: readerDone('capture', 'preparingPayload'),
					preparingPayload: {
						invoke: {
							src: actors.preparePayload,
							input,
							onDone: { target: 'validating' },
							onError: (args) => {
								return {
									target: 'cleaning',
									context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
								}
							}
						}
					},
					validating: {
						invoke: {
							src: actors.validate,
							input,
							onDone: (args) => {
								if (args.event.output) {
									return { target: 'committing' }
								}
								return {
									target: 'cleaning',
									context: { failure: 'invalidData' } satisfies Partial<Context>
								}
							},
							onError: (args) => {
								return {
									target: 'cleaning',
									context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
								}
							}
						}
					},
					committing: {
						invoke: {
							src: actors.commit,
							input,
							onDone: { target: 'confirming' },
							onError: (args) => {
								return {
									target: 'cleaning',
									context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
								}
							}
						}
					},
					confirming: {
						invoke: {
							src: actors.confirm,
							input,
							onDone: { target: 'preparing' },
							onError: (args) => {
								return {
									target: 'cleaning',
									context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
								}
							}
						}
					},
					preparing: {
						invoke: {
							src: actors.prepare,
							input,
							onDone: (args) => {
								return {
									target: 'protecting',
									context: { envelope: args.event.output } satisfies Partial<Context>
								}
							},
							onError: (args) => {
								return {
									target: 'cleaning',
									context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
								}
							}
						}
					},
					protecting: {
						on: {
							CANCEL: (args, enq) => {
								const { event: _event } = args
								let context = args.context
								let patch = {}
								patch = {
									...patch,
									interruption: context.interruption ?? 'cancelled'
								}
								context = { ...args.context, ...patch }
								enq(abort, { ...args, context })
								enq.sendTo('seal', { type: 'CANCEL' })
								return { context: patch satisfies Partial<Context> }
							},
							SHUTDOWN: (args, enq) => {
								const { event: _event } = args
								let context = args.context
								let patch = {}
								patch = {
									...patch,
									interruption: context.interruption ?? 'closed'
								}
								context = { ...args.context, ...patch }
								enq(abort, { ...args, context })
								enq.sendTo('seal', { type: 'SHUTDOWN' })
								return { context: patch satisfies Partial<Context> }
							},
							INVALIDATE: (args, enq) => {
								const { event: _event } = args
								let context = args.context
								let patch = {}
								patch = {
									...patch,
									interruption: context.interruption ?? 'invalidated'
								}
								context = { ...args.context, ...patch }
								enq(abort, { ...args, context })
								enq.sendTo('seal', { type: 'CANCEL' })
								return { context: patch satisfies Partial<Context> }
							}
						},
						invoke: {
							id: 'seal',
							src: actors.seal,
							input: ({ context }) => {
								if (!context.envelope) throw new Error('Missing protection request')
								return { request: context.envelope }
							},
							onDone: (args) => {
								if (args.context.interruption !== undefined) {
									return { target: 'cleaning' }
								}
								if (args.event.output.outcome === 'sealed') {
									return { target: 'handingOff' }
								}
								return {
									target: 'cleaning',
									context: { failure: 'failed' } satisfies Partial<Context>
								}
							},
							onError: (args) => {
								return {
									target: 'cleaning',
									context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
								}
							}
						}
					},
					handingOff: {
						invoke: {
							src: actors.handoff,
							input,
							onDone: (args) => {
								return {
									target: 'cleaning',
									context: {
										failure: args.event.output === 'dispatched' ? undefined : 'failed'
									} satisfies Partial<Context>
								}
							},
							onError: (args) => {
								return {
									target: 'cleaning',
									context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
								}
							}
						}
					},
					cleaning: {
						on: { CANCEL: {}, SHUTDOWN: {}, INVALIDATE: {} },
						entry: ({ context }, enq) => {
							enq(() => abortJazzExport(context.request))
						},
						invoke: {
							src: actors.cleanup,
							input,
							onDone: { target: '#jazz-archive-export.complete' },
							onError: (_args) => {
								return {
									target: '#jazz-archive-export.complete',
									context: { failure: 'cleanupFailed' } satisfies Partial<Context>
								}
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
