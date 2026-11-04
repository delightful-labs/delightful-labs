import { assign, fromPromise, sendTo, setup } from 'xstate'
import {
	buildCheckedArchive,
	buildSealedArchive,
	claimEnvelopeRequest,
	clearEnvelopeData,
	envelopeData,
	envelopeFailure,
	requireEnvelopeValue,
	type ArchiveEnvelopeRequest,
	type ArchiveEnvelopeResult,
	type EnvelopeSuccess
} from '../../backup/envelope-operation.js'
import { envelopeCrypto, type EnvelopeCryptoEvent } from '../../backup/envelope-native.js'
import { decodeBase64 } from '../../backup/binary.js'
import { newPasswordHeader, parseEnvelope, type EnvelopeMode } from '../../backup/envelope.js'
import { parseArchivePayload } from '../../backup/payload.js'

export type ArchiveEnvelopeInput = { request: ArchiveEnvelopeRequest }
export type ArchiveEnvelopeEvent = { type: 'CANCEL' | 'SHUTDOWN' }
type Event = ArchiveEnvelopeEvent | EnvelopeCryptoEvent
type Context = ArchiveEnvelopeInput & {
	mode: EnvelopeMode | undefined
	attachmentIndex: number
	attachmentCount: number
	acquired: boolean
	interruption: 'cancelled' | 'closed' | undefined
	result: ArchiveEnvelopeResult | undefined
}
function leaf<T>(run: (input: ArchiveEnvelopeInput) => T) {
	return fromPromise<T, ArchiveEnvelopeInput>(({ input }) => Promise.resolve(run(input)))
}
/** Single-use envelope owner. Native crypto drains on cancellation; actor stop only detaches it. */
export function createArchiveEnvelopeMachine() {
	const actors = {
		crypto: envelopeCrypto,
		cleanup: leaf(({ request }) => clearEnvelopeData(request)),
		claim: leaf(({ request }) => {
			claimEnvelopeRequest(request)
			return requireEnvelopeValue(envelopeData(request).initialMode)
		}),
		parseEnvelope: leaf(({ request }) => {
			const data = envelopeData(request)
			const envelope = parseEnvelope(requireEnvelopeValue(data.file), data.limits)
			data.parsedEnvelope = envelope
			data.file?.fill(0)
			data.file = undefined
			return envelope.protection
		}),
		decodePlainEnvelope: leaf(({ request }) => {
			const data = envelopeData(request)
			const envelope = requireEnvelopeValue(data.parsedEnvelope)
			if (envelope.protection !== 'none') throw new Error('Expected plain envelope')
			data.bytes = decodeBase64(envelope.payload, data.limits.payloadBytes)
			data.expectedDigest = envelope.sha256
			data.parsedEnvelope = undefined
		}),
		decodePasswordEnvelope: leaf(({ request }) => {
			const data = envelopeData(request)
			const envelope = requireEnvelopeValue(data.parsedEnvelope)
			if (envelope.protection !== 'password') throw new Error('Expected password envelope')
			const { payload, ...header } = envelope
			data.ciphertext = decodeBase64(payload, data.limits.payloadBytes + 16)
			data.header = Object.freeze(header)
			data.parsedEnvelope = undefined
		}),
		createPasswordHeader: leaf(({ request }) => {
			envelopeData(request).header = newPasswordHeader()
		}),
		parsePayload: leaf(({ request }) => {
			const data = envelopeData(request)
			data.payload = parseArchivePayload(requireEnvelopeValue(data.bytes), data.limits)
			return data.payload.attachments.length
		}),
		buildEnvelope: fromPromise<EnvelopeSuccess, ArchiveEnvelopeInput & { mode: EnvelopeMode }>(
			({ input }) => Promise.resolve(buildSealedArchive(input.request, input.mode))
		),
		buildChecked: leaf(({ request }) => buildCheckedArchive(request))
	}
	const model = setup<
		Context,
		Event,
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
		guards: {
			interrupted: ({ context }) =>
				context.interruption !== undefined || context.result?.outcome === 'failed'
		},
		actions: {
			fail: assign({
				result: ({ event }) =>
					'error' in event
						? envelopeFailure(event.error)
						: event.type === 'CRYPTO_FAILED'
							? event.failure
							: envelopeFailure(undefined)
			})
		}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const failed = { target: '#archive-envelope.cleaning', actions: 'fail' } satisfies {
		target: string
		actions: 'fail'
	}
	const interrupted = { guard: 'interrupted', target: '#archive-envelope.cleaning' } satisfies {
		guard: 'interrupted'
		target: string
	}
	const advance = (target: string) => [interrupted, { target }]
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
			CANCEL: { actions: assign({ interruption: 'cancelled' }) },
			SHUTDOWN: { actions: assign({ interruption: 'closed' }) },
			RELEASE: { actions: assign({ result: { outcome: 'failed', code: 'resourceReleased' } }) }
		},
		states: {
			claiming: {
				invoke: {
					src: 'claim',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'cleaning', actions: assign({ acquired: true }) },
						{
							guard: ({ event }) => event.output === 'sealPlain' || event.output === 'sealPassword',
							target: 'working.parsingPayload',
							actions: assign({ acquired: true, mode: ({ event }) => event.output })
						},
						{
							target: 'working.parsingEnvelope',
							actions: assign({ acquired: true, mode: ({ event }) => event.output })
						}
					],
					onError: failed
				}
			},
			working: {
				invoke: { id: 'crypto', src: 'crypto', input, onError: failed },
				initial: 'parsingEnvelope',
				on: { CRYPTO_FAILED: failed },
				states: {
					parsingEnvelope: {
						invoke: {
							src: 'parseEnvelope',
							input,
							onError: failed,
							onDone: [
								interrupted,
								{
									guard: ({ event }) => event.output === 'none',
									target: 'decodingPlainEnvelope',
									actions: assign({ mode: 'openPlain' })
								},
								{
									target: 'decodingPasswordEnvelope',
									actions: assign({ mode: 'openPassword' })
								}
							]
						}
					},
					decodingPlainEnvelope: {
						invoke: {
							src: 'decodePlainEnvelope',
							input,
							onDone: advance('hashingPayload'),
							onError: failed
						}
					},
					decodingPasswordEnvelope: {
						invoke: {
							src: 'decodePasswordEnvelope',
							input,
							onDone: advance('importingPassword'),
							onError: failed
						}
					},
					creatingPasswordHeader: {
						invoke: {
							src: 'createPasswordHeader',
							input,
							onDone: advance('checkingAttachments'),
							onError: failed
						}
					},
					checkingAttachments: {
						always: [
							interrupted,
							{
								guard: ({ context }) => context.attachmentIndex < context.attachmentCount,
								target: 'hashingAttachment'
							},
							{
								guard: ({ context }) => context.mode === 'sealPassword',
								target: 'importingPassword'
							},
							{ guard: ({ context }) => context.mode === 'sealPlain', target: 'hashingPayload' },
							{ target: 'buildingChecked' }
						]
					},
					hashingAttachment: {
						entry: sendTo('crypto', ({ context }) => ({
							type: 'HASH_ATTACHMENT',
							index: context.attachmentIndex
						})),
						on: { CRYPTO_DONE: advance('checkingAttachmentDigest') }
					},
					checkingAttachmentDigest: {
						always: [
							interrupted,
							{
								guard: ({ context }) => {
									const data = envelopeData(context.request)
									return (
										data.attachmentDigest !== undefined &&
										data.attachmentDigest ===
											data.payload?.attachments[context.attachmentIndex]?.sha256
									)
								},
								target: 'checkingAttachments',
								actions: assign({ attachmentIndex: ({ context }) => context.attachmentIndex + 1 })
							},
							{
								target: '#archive-envelope.cleaning',
								actions: assign({ result: { outcome: 'failed', code: 'integrityMismatch' } })
							}
						]
					},
					importingPassword: {
						entry: sendTo('crypto', { type: 'IMPORT_PASSWORD' }),
						on: { CRYPTO_DONE: advance('derivingKey') }
					},
					derivingKey: {
						entry: sendTo('crypto', ({ context }) => ({
							type: 'DERIVE_KEY',
							usage: context.mode === 'sealPassword' ? 'encrypt' : 'decrypt'
						})),
						on: {
							CRYPTO_DONE: [
								interrupted,
								{ guard: ({ context }) => context.mode === 'sealPassword', target: 'encrypting' },
								{ target: 'decrypting' }
							]
						},
						exit: ({ context }) => {
							envelopeData(context.request).material = undefined
						}
					},
					encrypting: {
						entry: sendTo('crypto', { type: 'ENCRYPT' }),
						on: { CRYPTO_DONE: advance('buildingEnvelope') },
						exit: ({ context }) => {
							envelopeData(context.request).key = undefined
						}
					},
					decrypting: {
						entry: sendTo('crypto', { type: 'DECRYPT' }),
						on: { CRYPTO_DONE: advance('checkingPlaintextBounds') },
						exit: ({ context }) => {
							envelopeData(context.request).key = undefined
						}
					},
					checkingPlaintextBounds: {
						always: [
							interrupted,
							{
								guard: ({ context }) =>
									requireEnvelopeValue(envelopeData(context.request).bytes).length <=
									envelopeData(context.request).limits.payloadBytes,
								target: 'hashingPayload'
							},
							{
								target: '#archive-envelope.cleaning',
								actions: assign({ result: { outcome: 'failed', code: 'limitExceeded' } })
							}
						]
					},
					hashingPayload: {
						entry: sendTo('crypto', { type: 'HASH_PAYLOAD' }),
						on: { CRYPTO_DONE: advance('checkingPayloadDigest') }
					},
					checkingPayloadDigest: {
						always: [
							interrupted,
							{
								guard: ({ context }) => {
									const data = envelopeData(context.request)
									return data.expectedDigest !== undefined && data.expectedDigest !== data.digest
								},
								target: '#archive-envelope.cleaning',
								actions: assign({ result: { outcome: 'failed', code: 'integrityMismatch' } })
							},
							{ guard: ({ context }) => context.mode === 'sealPlain', target: 'buildingEnvelope' },
							{ target: 'parsingPayload' }
						]
					},
					parsingPayload: {
						invoke: {
							src: 'parsePayload',
							input,
							onError: failed,
							onDone: [
								interrupted,
								{
									guard: ({ context }) => context.mode === 'sealPassword',
									target: 'creatingPasswordHeader',
									actions: assign({ attachmentCount: ({ event }) => event.output })
								},
								{
									target: 'checkingAttachments',
									actions: assign({ attachmentCount: ({ event }) => event.output })
								}
							]
						}
					},
					transferring: {
						entry: ({ context }) => clearEnvelopeData(context.request, true),
						always: '#archive-envelope.cleaning'
					},
					buildingEnvelope: {
						invoke: {
							src: 'buildEnvelope',
							input: ({ context }) => ({
								request: context.request,
								mode: requireEnvelopeValue(context.mode)
							}),
							onError: failed,
							onDone: [
								interrupted,
								{ target: 'transferring', actions: assign({ result: ({ event }) => event.output }) }
							]
						}
					},
					buildingChecked: {
						invoke: {
							src: 'buildChecked',
							input,
							onError: failed,
							onDone: [
								interrupted,
								{ target: 'transferring', actions: assign({ result: ({ event }) => event.output }) }
							]
						}
					}
				},
				// Dispose before the native child stops; successful output is transferred, all other data revoked.
				exit: ({ context }) => clearEnvelopeData(context.request)
			},
			cleaning: {
				always: { guard: ({ context }) => !context.acquired, target: 'complete' },
				invoke: {
					src: 'cleanup',
					input,
					onDone: {
						target: 'complete',
						actions: ({ context }) => {
							if (
								context.interruption &&
								(context.result?.outcome === 'sealed' ||
									context.result?.outcome === 'integrityChecked')
							)
								context.result.archive.release()
						}
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
