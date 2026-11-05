import { raise, assign, sendTo, setup } from 'xstate'
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

export type ArchiveEnvelopeInput = { request: ArchiveEnvelopeRequest }
export type ArchiveEnvelopeEvent = { type: 'CANCEL' | 'SHUTDOWN' }
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
	| { type: 'SYNC_COMPLETED'; patch: Partial<Context> }
	| { type: 'SYNC_APPLIED' }
/** Single-use envelope owner. Native crypto drains on cancellation; actor stop only detaches it. */
export function createArchiveEnvelopeMachine() {
	const actors = { crypto: envelopeCrypto }
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
				context.interruption !== undefined ||
				context.result?.outcome === 'failed' ||
				(context.acquired && envelopeData(context.request).initialMode === undefined)
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
	// Admit bounded synchronous transform failures; the chart selects cleanup and outcomes.
	const synchronous = (run: (context: Context) => Partial<Context>) =>
		model.createAction(({ context, self }) => {
			try {
				self.send({ type: 'SYNC_COMPLETED', patch: run(context) })
			} catch (error) {
				self.send({ type: 'SYNC_COMPLETED', patch: { result: envelopeFailure(error) } })
			}
		})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const failed = { target: '#archive-envelope.cleaning', actions: 'fail' } satisfies {
		target: string
		actions: 'fail'
	}
	const interrupted = {
		guard: 'interrupted',
		target: '#archive-envelope.cleaning',
		actions: model.assign(({ context }) =>
			context.interruption === undefined && context.result?.outcome !== 'failed'
				? { result: { outcome: 'failed', code: 'resourceReleased' } }
				: {}
		)
	} satisfies { guard: 'interrupted'; target: string; actions: unknown }
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
			SYNC_COMPLETED: {
				actions: [
					model.assign(({ event }) => (event.type === 'SYNC_COMPLETED' ? event.patch : {})),
					raise({ type: 'SYNC_APPLIED' })
				]
			},
			CANCEL: { actions: assign({ interruption: 'cancelled' }) },
			SHUTDOWN: { actions: assign({ interruption: 'closed' }) },
			RELEASE: { actions: assign({ result: { outcome: 'failed', code: 'resourceReleased' } }) }
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
					SYNC_APPLIED: [
						{ guard: ({ context }) => !context.acquired, target: 'complete' },
						{ guard: 'interrupted', target: 'cleaning' },
						{
							guard: ({ context }) => context.mode === 'sealPassword',
							target: 'working.creatingPasswordHeader'
						},
						{
							guard: ({ context }) => context.mode === 'sealPlain',
							target: 'working.checkingAttachments'
						},
						{ target: 'working.parsingEnvelope' }
					]
				}
			},
			working: {
				invoke: { id: 'crypto', src: 'crypto', input, onError: failed },
				initial: 'parsingEnvelope',
				on: { CRYPTO_FAILED: failed },
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
							SYNC_APPLIED: [
								interrupted,
								{
									guard: ({ context }) => context.mode === 'openPlain',
									target: 'decodingPlainEnvelope'
								},
								{ target: 'decodingPasswordEnvelope' }
							]
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
						on: { SYNC_APPLIED: advance('hashingPayload') }
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
						on: { SYNC_APPLIED: advance('importingPassword') }
					},
					creatingPasswordHeader: {
						entry: synchronous(({ request }) => {
							envelopeData(request).header = newPasswordHeader()
							return {}
						}),
						on: { SYNC_APPLIED: advance('checkingAttachments') }
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
									(envelopeData(context.request).bytes?.length ?? Infinity) <=
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
						entry: synchronous(({ request }) => {
							const data = envelopeData(request)
							data.payload = parseArchivePayload(requireEnvelopeValue(data.bytes), data.limits)
							return { attachmentCount: data.payload.attachments.length }
						}),
						on: { SYNC_APPLIED: advance('checkingAttachments') }
					},
					transferring: {
						entry: synchronous(({ request }) => {
							clearEnvelopeData(request, true)
							return {}
						}),
						on: { SYNC_APPLIED: '#archive-envelope.cleaning' }
					},
					buildingEnvelope: {
						entry: synchronous(({ request, mode }) => ({
							result: buildSealedArchive(request, requireEnvelopeValue(mode))
						})),
						on: { SYNC_APPLIED: [interrupted, { target: 'transferring' }] }
					},
					buildingChecked: {
						entry: synchronous(({ request }) => ({ result: buildCheckedArchive(request) })),
						on: { SYNC_APPLIED: [interrupted, { target: 'transferring' }] }
					}
				},
				// Dispose before the native child stops; successful output is transferred, all other data revoked.
				exit: ({ context }) => clearEnvelopeData(context.request)
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
				on: { SYNC_APPLIED: 'complete' }
			},
			complete: { type: 'final' }
		}
	})
}
