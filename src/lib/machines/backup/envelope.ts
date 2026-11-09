import { types, setup } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import {
	buildCheckedArchive,
	buildSealedArchive,
	claimEnvelopeRequest,
	clearEnvelopeData,
	envelopeData,
	envelopeFailure,
	requireEnvelopeValue,
	type ArchiveEnvelopeRequest,
	type ArchiveEnvelopeResult
} from '../../backup/envelope-operation.js'
import { envelopeCrypto, type EnvelopeCryptoEvent } from '../../backup/envelope-native.js'
import { decodeBase64 } from '../../backup/binary.js'
import { newPasswordHeader, parseEnvelope, type EnvelopeMode } from '../../backup/envelope.js'
import { parseArchivePayload } from '../../backup/payload.js'
export type ArchiveEnvelopeInput = {
	request: ArchiveEnvelopeRequest
}
export type ArchiveEnvelopeEvent = {
	type: 'CANCEL' | 'SHUTDOWN'
}
type Event = ArchiveEnvelopeEvent | EnvelopeCryptoEvent | SynchronousEvent
type Context = ArchiveEnvelopeInput & {
	mode: EnvelopeMode | undefined
	attachmentIndex: number
	attachmentCount: number
	acquired: boolean
	interruption: 'cancelled' | 'closed' | undefined
	result: ArchiveEnvelopeResult | undefined
}
type SynchronousEvent =
	| {
			type: 'SYNC_COMPLETED'
			patch: Partial<Context>
	  }
	| {
			type: 'SYNC_APPLIED'
	  }
/** Single-use envelope owner. Native crypto drains on cancellation; actor stop only detaches it. */
export function createArchiveEnvelopeMachine() {
	const actors = { crypto: envelopeCrypto }
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
					? envelopeFailure(event.error)
					: event.type === 'CRYPTO_FAILED'
						? event.failure
						: envelopeFailure(undefined)
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				RELEASE: types<EventPayload<Event, 'RELEASE'>>(),
				CRYPTO_DONE: types<EventPayload<Event, 'CRYPTO_DONE'>>(),
				CRYPTO_FAILED: types<EventPayload<Event, 'CRYPTO_FAILED'>>(),
				SYNC_COMPLETED: types<EventPayload<Event, 'SYNC_COMPLETED'>>()
			},
			internalEvents: { SYNC_APPLIED: types<EventPayload<Event, 'SYNC_APPLIED'>>() },
			input: types<ArchiveEnvelopeInput>(),
			output: types<ArchiveEnvelopeResult>()
		},
		actors,
		guards: {
			interrupted: ({ context }: { context: Context }) =>
				context.interruption !== undefined ||
				context.result?.outcome === 'failed' ||
				(context.acquired && envelopeData(context.request).initialMode === undefined)
		},
		actions: {}
	})
	// Admit bounded synchronous transform failures; the chart selects cleanup and outcomes.
	const synchronous = (run: (context: Context) => Partial<Context>) =>
		model.createStateConfig({
			entry: ({ context, self }, enq) => {
				enq(() => {
					try {
						self.send({ type: 'SYNC_COMPLETED', patch: run(context) })
					} catch (error) {
						self.send({ type: 'SYNC_COMPLETED', patch: { result: envelopeFailure(error) } })
					}
				})
			}
		}).entry
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	return model.createMachine({
		id: 'archive-envelope',
		initial: 'claiming',
		context: ({ input }) => ({
			request: input.request,
			mode: undefined,
			attachmentIndex: 0,
			attachmentCount: 0,
			acquired: false,
			interruption: undefined,
			result: undefined
		}),
		output: ({ context }) =>
			context.interruption
				? { outcome: context.interruption }
				: (context.result ?? { outcome: 'failed', code: 'cryptoFailed' }),
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
			},
			RELEASE: (_args) => {
				return {
					context: {
						result: { outcome: 'failed', code: 'resourceReleased' }
					} satisfies Partial<Context>
				}
			}
		},
		states: {
			claiming: {
				entry: synchronous((context) => {
					claimEnvelopeRequest(context.request)
					return {
						acquired: true,
						mode: requireEnvelopeValue(envelopeData(context.request).initialMode),
						attachmentCount: envelopeData(context.request).payload?.attachments.length ?? 0
					}
				}),
				on: {
					SYNC_APPLIED: (args) => {
						const { context } = args
						if (!context.acquired) {
							return { target: 'complete' }
						}
						if (args.guards.interrupted(args)) {
							return { target: 'cleaning' }
						}
						if (context.mode === 'sealPassword') {
							return { target: 'working.creatingPasswordHeader' }
						}
						if (context.mode === 'sealPlain') {
							return { target: 'working.checkingAttachments' }
						}
						return { target: 'working.parsingEnvelope' }
					}
				}
			},
			working: {
				invoke: {
					id: 'crypto',
					src: actors.crypto,
					input,
					onError: (args) => {
						return {
							target: '#archive-envelope.cleaning',
							context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
						}
					}
				},
				initial: 'parsingEnvelope',
				on: {
					CRYPTO_FAILED: (args) => {
						return {
							target: '#archive-envelope.cleaning',
							context: ((args) => patches.fail(args))(args) satisfies Partial<Context>
						}
					}
				},
				states: {
					parsingEnvelope: {
						entry: synchronous(({ request }) => {
							const data = envelopeData(request)
							const envelope = parseEnvelope(requireEnvelopeValue(data.file), data.limits)
							data.parsedEnvelope = envelope
							data.file?.fill(0)
							data.file = undefined
							return { mode: envelope.protection === 'none' ? 'openPlain' : 'openPassword' }
						}),
						on: {
							SYNC_APPLIED: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								if (context.mode === 'openPlain') {
									return { target: 'decodingPlainEnvelope' }
								}
								return { target: 'decodingPasswordEnvelope' }
							}
						}
					},
					decodingPlainEnvelope: {
						entry: synchronous(({ request }) => {
							const data = envelopeData(request),
								envelope = data.parsedEnvelope
							if (envelope?.protection !== 'none')
								return { result: { outcome: 'failed', code: 'invalidEnvelope' } }
							data.bytes = decodeBase64(envelope.payload, data.limits.payloadBytes)
							data.expectedDigest = envelope.sha256
							data.parsedEnvelope = undefined
							return {}
						}),
						on: {
							SYNC_APPLIED: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								return { target: 'hashingPayload' }
							}
						}
					},
					decodingPasswordEnvelope: {
						entry: synchronous(({ request }) => {
							const data = envelopeData(request),
								envelope = data.parsedEnvelope
							if (envelope?.protection !== 'password')
								return { result: { outcome: 'failed', code: 'invalidEnvelope' } }
							const { payload, ...header } = envelope
							data.ciphertext = decodeBase64(payload, data.limits.payloadBytes + 16)
							data.header = Object.freeze(header)
							data.parsedEnvelope = undefined
							return {}
						}),
						on: {
							SYNC_APPLIED: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								return { target: 'importingPassword' }
							}
						}
					},
					creatingPasswordHeader: {
						entry: synchronous(({ request }) => {
							envelopeData(request).header = newPasswordHeader()
							return {}
						}),
						on: {
							SYNC_APPLIED: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								return { target: 'checkingAttachments' }
							}
						}
					},
					checkingAttachments: {
						always: (args) => {
							const { context } = args
							if (args.guards.interrupted(args)) {
								return {
									target: '#archive-envelope.cleaning',
									context: (context.interruption === undefined &&
									context.result?.outcome !== 'failed'
										? { result: { outcome: 'failed', code: 'resourceReleased' } }
										: {}) satisfies Partial<Context>
								}
							}
							if (context.attachmentIndex < context.attachmentCount) {
								return { target: 'hashingAttachment' }
							}
							if (context.mode === 'sealPassword') {
								return { target: 'importingPassword' }
							}
							if (context.mode === 'sealPlain') {
								return { target: 'hashingPayload' }
							}
							return { target: 'buildingChecked' }
						}
					},
					hashingAttachment: {
						entry: (args, enq) => {
							enq.sendTo('crypto', {
								type: 'HASH_ATTACHMENT',
								index: args.context.attachmentIndex
							})
						},
						on: {
							CRYPTO_DONE: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								return { target: 'checkingAttachmentDigest' }
							}
						}
					},
					checkingAttachmentDigest: {
						always: (args) => {
							const { context } = args
							if (args.guards.interrupted(args)) {
								return {
									target: '#archive-envelope.cleaning',
									context: (context.interruption === undefined &&
									context.result?.outcome !== 'failed'
										? { result: { outcome: 'failed', code: 'resourceReleased' } }
										: {}) satisfies Partial<Context>
								}
							}
							if (
								(({ context }) => {
									const data = envelopeData(context.request)
									return (
										data.attachmentDigest !== undefined &&
										data.attachmentDigest ===
											data.payload?.attachments[context.attachmentIndex]?.sha256
									)
								})(args)
							) {
								return {
									target: 'checkingAttachments',
									context: {
										attachmentIndex: context.attachmentIndex + 1
									} satisfies Partial<Context>
								}
							}
							return {
								target: '#archive-envelope.cleaning',
								context: {
									result: { outcome: 'failed', code: 'integrityMismatch' }
								} satisfies Partial<Context>
							}
						}
					},
					importingPassword: {
						entry: (args, enq) => {
							enq.sendTo('crypto', { type: 'IMPORT_PASSWORD' })
						},
						on: {
							CRYPTO_DONE: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								return { target: 'derivingKey' }
							}
						}
					},
					derivingKey: {
						entry: (args, enq) => {
							enq.sendTo('crypto', {
								type: 'DERIVE_KEY',
								usage: args.context.mode === 'sealPassword' ? 'encrypt' : 'decrypt'
							})
						},
						on: {
							CRYPTO_DONE: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								if (context.mode === 'sealPassword') {
									return { target: 'encrypting' }
								}
								return { target: 'decrypting' }
							}
						},
						exit: ({ context }, enq) => {
							enq(() => {
								envelopeData(context.request).material = undefined
							})
						}
					},
					encrypting: {
						entry: (args, enq) => {
							enq.sendTo('crypto', { type: 'ENCRYPT' })
						},
						on: {
							CRYPTO_DONE: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								return { target: 'buildingEnvelope' }
							}
						},
						exit: ({ context }, enq) => {
							enq(() => {
								envelopeData(context.request).key = undefined
							})
						}
					},
					decrypting: {
						entry: (args, enq) => {
							enq.sendTo('crypto', { type: 'DECRYPT' })
						},
						on: {
							CRYPTO_DONE: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								return { target: 'checkingPlaintextBounds' }
							}
						},
						exit: ({ context }, enq) => {
							enq(() => {
								envelopeData(context.request).key = undefined
							})
						}
					},
					checkingPlaintextBounds: {
						always: (args) => {
							const { context } = args
							if (args.guards.interrupted(args)) {
								return {
									target: '#archive-envelope.cleaning',
									context: (context.interruption === undefined &&
									context.result?.outcome !== 'failed'
										? { result: { outcome: 'failed', code: 'resourceReleased' } }
										: {}) satisfies Partial<Context>
								}
							}
							if (
								(envelopeData(context.request).bytes?.length ?? Infinity) <=
								envelopeData(context.request).limits.payloadBytes
							) {
								return { target: 'hashingPayload' }
							}
							return {
								target: '#archive-envelope.cleaning',
								context: {
									result: { outcome: 'failed', code: 'limitExceeded' }
								} satisfies Partial<Context>
							}
						}
					},
					hashingPayload: {
						entry: (args, enq) => {
							enq.sendTo('crypto', { type: 'HASH_PAYLOAD' })
						},
						on: {
							CRYPTO_DONE: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								return { target: 'checkingPayloadDigest' }
							}
						}
					},
					checkingPayloadDigest: {
						always: (args) => {
							const { context } = args
							if (args.guards.interrupted(args)) {
								return {
									target: '#archive-envelope.cleaning',
									context: (context.interruption === undefined &&
									context.result?.outcome !== 'failed'
										? { result: { outcome: 'failed', code: 'resourceReleased' } }
										: {}) satisfies Partial<Context>
								}
							}
							if (
								(({ context }) => {
									const data = envelopeData(context.request)
									return data.expectedDigest !== undefined && data.expectedDigest !== data.digest
								})(args)
							) {
								return {
									target: '#archive-envelope.cleaning',
									context: {
										result: { outcome: 'failed', code: 'integrityMismatch' }
									} satisfies Partial<Context>
								}
							}
							if (context.mode === 'sealPlain') {
								return { target: 'buildingEnvelope' }
							}
							return { target: 'parsingPayload' }
						}
					},
					parsingPayload: {
						entry: synchronous(({ request }) => {
							const data = envelopeData(request)
							data.payload = parseArchivePayload(requireEnvelopeValue(data.bytes), data.limits)
							return { attachmentCount: data.payload.attachments.length }
						}),
						on: {
							SYNC_APPLIED: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								return { target: 'checkingAttachments' }
							}
						}
					},
					transferring: {
						entry: synchronous(({ request }) => {
							clearEnvelopeData(request, true)
							return {}
						}),
						on: { SYNC_APPLIED: { target: '#archive-envelope.cleaning' } }
					},
					buildingEnvelope: {
						entry: synchronous(({ request, mode }) => ({
							result: buildSealedArchive(request, requireEnvelopeValue(mode))
						})),
						on: {
							SYNC_APPLIED: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								return { target: 'transferring' }
							}
						}
					},
					buildingChecked: {
						entry: synchronous(({ request }) => ({ result: buildCheckedArchive(request) })),
						on: {
							SYNC_APPLIED: (args) => {
								const { context } = args
								if (args.guards.interrupted(args)) {
									return {
										target: '#archive-envelope.cleaning',
										context: (context.interruption === undefined &&
										context.result?.outcome !== 'failed'
											? { result: { outcome: 'failed', code: 'resourceReleased' } }
											: {}) satisfies Partial<Context>
									}
								}
								return { target: 'transferring' }
							}
						}
					}
				},
				// Queue revocation with the owning exit; native teardown shares idempotent cleanup.
				exit: ({ context }, enq) => {
					enq(() => clearEnvelopeData(context.request))
				}
			},
			cleaning: {
				entry: synchronous((context) => {
					if (context.acquired) clearEnvelopeData(context.request)
					if (
						context.interruption &&
						(context.result?.outcome === 'sealed' || context.result?.outcome === 'integrityChecked')
					)
						context.result.archive.release()
					return {}
				}),
				on: { SYNC_APPLIED: { target: 'complete' } }
			},
			complete: { type: 'final' }
		}
	})
}
