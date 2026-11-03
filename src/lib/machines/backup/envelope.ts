import { assign, fromPromise, setup } from 'xstate'
import {
	envelopeFailure,
	envelopeOperation,
	type ArchiveEnvelopeRequest,
	type ArchiveEnvelopeResult
} from '../../backup/envelope-operation.js'
import type { EnvelopeMode } from '../../backup/envelope.js'

export type ArchiveEnvelopeInput = { request: ArchiveEnvelopeRequest }
export type ArchiveEnvelopeEvent = { type: 'CANCEL' | 'SHUTDOWN' }
type Context = ArchiveEnvelopeInput & {
	mode: EnvelopeMode | undefined
	acquired: boolean
	interruption: 'cancelled' | 'closed' | undefined
	result: ArchiveEnvelopeResult | undefined
}
function leaf<Output>(
	run: (operation: ReturnType<typeof envelopeOperation>) => Output | PromiseLike<Output>
) {
	return fromPromise<Output, ArchiveEnvelopeInput>(({ input }) =>
		Promise.resolve(run(envelopeOperation(input.request)))
	)
}

/** One single-use request per actor. Gracefully drain with CANCEL/SHUTDOWN before stopping. */
export function createArchiveEnvelopeMachine() {
	const actors = {
		claim: leaf((operation) => operation.claim()),
		prepare: leaf((operation) => operation.prepare()),
		importPassword: leaf((operation) => operation.importPassword()),
		deriveKey: leaf((operation) => operation.deriveKey()),
		encrypt: leaf((operation) => operation.encrypt()),
		decrypt: leaf((operation) => operation.decrypt()),
		hashPayload: leaf((operation) => operation.hashPayload()),
		parsePayload: leaf((operation) => operation.parsePayload()),
		hashAttachment: leaf((operation) => operation.hashAttachment()),
		buildEnvelope: leaf((operation) => operation.buildEnvelope()),
		buildChecked: leaf((operation) => operation.buildChecked()),
		cleanup: fromPromise<void, ArchiveEnvelopeInput & { keepOutput: boolean }>(({ input }) => {
			envelopeOperation(input.request).cleanup(input.keepOutput)
			return Promise.resolve()
		})
	}
	const model = setup<
		Context,
		ArchiveEnvelopeEvent,
		typeof actors,
		{},
		{ fail: undefined },
		{ interrupted: undefined },
		never,
		string,
		ArchiveEnvelopeInput,
		ArchiveEnvelopeResult
	>({
		actors,
		guards: { interrupted: ({ context }) => context.interruption !== undefined },
		actions: {
			fail: assign({
				result: ({ event }): ArchiveEnvelopeResult =>
					'error' in event
						? envelopeFailure(event.error)
						: { outcome: 'failed', code: 'cryptoFailed' }
			})
		}
	})
	const input = ({ context }: { context: Context }): ArchiveEnvelopeInput => ({
		request: context.request
	})
	const failed = { target: 'cleaning', actions: 'fail' } satisfies {
		target: string
		actions: 'fail'
	}
	function advance(
		target: string
	): ({ guard: 'interrupted'; target: string } | { target: string })[] {
		return [{ guard: 'interrupted', target: 'cleaning' }, { target }]
	}
	return model.createMachine({
		id: 'archive-envelope',
		initial: 'claiming',
		context: ({ input }) => ({
			request: input.request,
			mode: undefined,
			acquired: false,
			interruption: undefined,
			result: undefined
		}),
		output: ({ context }) =>
			context.interruption
				? { outcome: context.interruption }
				: (context.result ?? { outcome: 'failed', code: 'cryptoFailed' }),
		on: {
			CANCEL: { actions: assign({ interruption: 'cancelled' }) },
			SHUTDOWN: { actions: assign({ interruption: 'closed' }) }
		},
		states: {
			claiming: {
				invoke: {
					src: 'claim',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning', actions: assign({ acquired: true }) },
						{ target: 'preparing', actions: assign({ acquired: true }) }
					],
					onError: failed
				}
			},
			preparing: {
				invoke: {
					src: 'prepare',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning' },
						{
							guard: ({ event }) => event.output === 'openPlain',
							target: 'hashingPayload',
							actions: assign({ mode: ({ event }) => event.output })
						},
						{
							guard: ({ event }) => event.output === 'openPassword',
							target: 'importingPassword',
							actions: assign({ mode: ({ event }) => event.output })
						},
						{
							target: 'checkingAttachments',
							actions: assign({ mode: ({ event }) => event.output })
						}
					],
					onError: failed
				}
			},
			checkingAttachments: {
				always: [
					{ guard: 'interrupted', target: 'cleaning' },
					{
						guard: ({ context }) => envelopeOperation(context.request).hasAttachment(),
						target: 'hashingAttachment'
					},
					{ guard: ({ context }) => context.mode === 'sealPassword', target: 'importingPassword' },
					{ guard: ({ context }) => context.mode === 'sealPlain', target: 'hashingPayload' },
					{ target: 'buildingChecked' }
				]
			},
			hashingAttachment: {
				invoke: {
					src: 'hashAttachment',
					input,
					onDone: advance('checkingAttachments'),
					onError: failed
				}
			},
			importingPassword: {
				invoke: { src: 'importPassword', input, onDone: advance('derivingKey'), onError: failed }
			},
			derivingKey: {
				invoke: {
					src: 'deriveKey',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning' },
						{ guard: ({ context }) => context.mode === 'sealPassword', target: 'encrypting' },
						{ target: 'decrypting' }
					],
					onError: failed
				}
			},
			encrypting: {
				invoke: { src: 'encrypt', input, onDone: advance('buildingEnvelope'), onError: failed }
			},
			decrypting: {
				invoke: { src: 'decrypt', input, onDone: advance('hashingPayload'), onError: failed }
			},
			hashingPayload: {
				invoke: {
					src: 'hashPayload',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning' },
						{ guard: ({ context }) => context.mode === 'sealPlain', target: 'buildingEnvelope' },
						{ target: 'parsingPayload' }
					],
					onError: failed
				}
			},
			parsingPayload: {
				invoke: {
					src: 'parsePayload',
					input,
					onDone: advance('checkingAttachments'),
					onError: failed
				}
			},
			buildingEnvelope: {
				invoke: {
					src: 'buildEnvelope',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning' },
						{ target: 'cleaning', actions: assign({ result: ({ event }) => event.output }) }
					],
					onError: failed
				}
			},
			buildingChecked: {
				invoke: {
					src: 'buildChecked',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning' },
						{ target: 'cleaning', actions: assign({ result: ({ event }) => event.output }) }
					],
					onError: failed
				}
			},
			cleaning: {
				always: { guard: ({ context }) => !context.acquired, target: 'complete' },
				invoke: {
					src: 'cleanup',
					input: ({ context }) => ({
						request: context.request,
						keepOutput:
							context.interruption === undefined &&
							(context.result?.outcome === 'sealed' ||
								context.result?.outcome === 'integrityChecked')
					}),
					onDone: {
						target: 'complete',
						actions: assign({
							result: ({ context }): ArchiveEnvelopeResult => {
								if (context.interruption) {
									if (
										context.result?.outcome === 'sealed' ||
										context.result?.outcome === 'integrityChecked'
									)
										context.result.archive.release()
									return { outcome: context.interruption }
								}
								return context.result ?? { outcome: 'failed', code: 'cryptoFailed' }
							}
						})
					},
					onError: {
						target: 'complete',
						actions: [
							({ context }) => {
								if (
									context.result?.outcome === 'sealed' ||
									context.result?.outcome === 'integrityChecked'
								)
									context.result.archive.release()
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
