import { createBankTrace, type BankTrace } from '#lib/integrations/diagnostics.js'
import {
	createPasskey,
	encryptPasskeySample,
	verifyPasskeySample,
	type PasskeyDescriptor,
	type PasskeySample,
	type CredentialSealer
} from '#lib/integrations/passkey.js'
import { claimToken, validateSetupToken } from '#lib/integrations/simplefin.js'
import type { CredentialEnvelope } from '#lib/validation/integrations.js'
import { createAuthorizationMachine } from './authorization.js'
import { createSetupBaselineMachine, type SetupBaseline } from './setup-baseline.js'
import { createSetupPersistenceMachine } from './setup-persist.js'
import { createPreparationMachine, type PreparedScope } from './preparation.js'
import { required } from './identity.js'
import { bankLock } from './lock.js'
import { bankEnvironment } from './types.js'
import type {
	AuthorizationRequest,
	BankEvent,
	Dependencies,
	LockEvent,
	RequestIdentity,
	BankViewMeta
} from './types.js'
import { types, matchesState, setup, createAsyncLogic } from 'xstate'
import type { EventObject, ErrorActorEvent } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Base = SetupBaseline & { trace: BankTrace }
type Material =
	| { passkey: PasskeyDescriptor }
	| { sample: PasskeySample }
	| { seal: CredentialSealer }
	| { encrypted: CredentialEnvelope }
type Input = { token: string }
type Context = {
	identity: RequestIdentity
	credentialFingerprint: string
	token: string | undefined
	base: Base | undefined
	material: Material | undefined
	accessUrl: string | undefined
	error: unknown
	completion: Output | undefined
	settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
}
type Output =
	| { kind: 'complete' }
	| { kind: 'cancelled'; settlement: Context['settlement'] }
	| { kind: 'failed'; error: unknown; settlement: Context['settlement'] }
type Event =
	BankEvent | LockEvent | ErrorActorEvent | { type: 'CREDENTIAL_CHANGED'; fingerprint: string }
function baseFor(context: Context) {
	return required(context.base)
}
function authorizationFor(context: Context): AuthorizationRequest {
	return { scope: baseFor(context).scope, requireConnection: false, expectedCiphertext: undefined }
}

export function createBankSetupMachine(dependencies: Dependencies) {
	const { observe, passkeyName } = dependencies
	const validateToken = createAsyncLogic<void, { token: string; base: Base }>({
		run: async ({ input, signal }) => {
			signal.throwIfAborted()
			await validateSetupToken(input.token, input.base.trace)
		}
	})
	const create = createAsyncLogic<PasskeyDescriptor, Base>({
		run: ({ input, signal }) => createPasskey(input.scope, signal, passkeyName(), input.trace)
	})
	const encrypt = createAsyncLogic<PasskeySample, { base: Base; passkey: PasskeyDescriptor }>({
		run: ({ input, signal }) =>
			encryptPasskeySample(input.base.scope, input.passkey, signal, input.base.trace)
	})
	const verify = createAsyncLogic<CredentialSealer, { base: Base; sample: PasskeySample }>({
		run: ({ input, signal }) =>
			verifyPasskeySample(input.base.scope, input.sample, signal, input.base.trace)
	})
	const claim = createAsyncLogic<string, { token: string; base: Base }>({
		run: ({ input, signal }) => claimToken(input.token, signal, input.base.trace)
	})
	const seal = createAsyncLogic<CredentialEnvelope, { seal: CredentialSealer; accessUrl: string }>({
		run: ({ input, signal }) => input.seal(input.accessUrl, signal)
	})
	const actors = {
		startBase: createAsyncLogic<Base, PreparedScope>({
			run: async ({ input }) => ({
				scope: input.scope,
				baselineCiphertext: input.connection?.ciphertext ?? null,
				baselineStatus: input.connection?.status ?? null,
				trace: createBankTrace('CONNECT')
			})
		}),
		lock: bankLock,
		prepare: createPreparationMachine(dependencies),
		authorize: createAuthorizationMachine(dependencies),
		checkBaseline: createSetupBaselineMachine(dependencies),
		validateToken,
		create,
		encrypt,
		verify,
		claim,
		seal,
		persist: createSetupPersistenceMachine(dependencies)
	}
	const events0 = {
		DISCOVER: types<EventPayload<Event, 'DISCOVER'>>(),
		SYNC: types<EventPayload<Event, 'SYNC'>>(),
		MAP: types<EventPayload<Event, 'MAP'>>(),
		CREATE_ACCOUNT: types<EventPayload<Event, 'CREATE_ACCOUNT'>>(),
		DISCONNECT: types<EventPayload<Event, 'DISCONNECT'>>(),
		CONNECT: types<EventPayload<Event, 'CONNECT'>>(),
		TEST_ENCRYPTION: types<EventPayload<Event, 'TEST_ENCRYPTION'>>(),
		VERIFY_DECRYPTION: types<EventPayload<Event, 'VERIFY_DECRYPTION'>>(),
		SAVE_CONNECTION: types<EventPayload<Event, 'SAVE_CONNECTION'>>(),
		CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
		RESET: types<EventPayload<Event, 'RESET'>>(),
		LOCK_ACQUIRED: types<EventPayload<Event, 'LOCK_ACQUIRED'>>(),
		LOCK_FAILED: types<EventPayload<Event, 'LOCK_FAILED'>>(),
		CREDENTIAL_CHANGED: types<EventPayload<Event, 'CREDENTIAL_CHANGED'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['lock']>
				| import('xstate').OutputFrom<(typeof actors)['prepare']>
				| import('xstate').OutputFrom<(typeof actors)['authorize']>
				| import('xstate').OutputFrom<(typeof actors)['checkBaseline']>
				| import('xstate').OutputFrom<(typeof actors)['validateToken']>
				| import('xstate').OutputFrom<(typeof actors)['create']>
				| import('xstate').OutputFrom<(typeof actors)['encrypt']>
				| import('xstate').OutputFrom<(typeof actors)['verify']>
				| import('xstate').OutputFrom<(typeof actors)['claim']>
				| import('xstate').OutputFrom<(typeof actors)['seal']>
				| import('xstate').OutputFrom<(typeof actors)['persist']>
		  >
		| import('xstate').ErrorActorEvent
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<Output>(),
			children: {
				lock: types<import('xstate').ActorRefFrom<(typeof actors)['lock']>>(),
				startBase: types<import('xstate').ActorRefFrom<(typeof actors)['startBase']>>(),
				prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>(),
				authorize: types<import('xstate').ActorRefFrom<(typeof actors)['authorize']>>(),
				checkBaseline: types<import('xstate').ActorRefFrom<(typeof actors)['checkBaseline']>>(),
				validateToken: types<import('xstate').ActorRefFrom<(typeof actors)['validateToken']>>(),
				create: types<import('xstate').ActorRefFrom<(typeof actors)['create']>>(),
				encrypt: types<import('xstate').ActorRefFrom<(typeof actors)['encrypt']>>(),
				verify: types<import('xstate').ActorRefFrom<(typeof actors)['verify']>>(),
				claim: types<import('xstate').ActorRefFrom<(typeof actors)['claim']>>(),
				seal: types<import('xstate').ActorRefFrom<(typeof actors)['seal']>>(),
				persist: types<import('xstate').ActorRefFrom<(typeof actors)['persist']>>()
			},
			meta: types<BankViewMeta>()
		},
		states: {
			creating: {
				states: {
					locking: {},
					preparing: {},
					allocatingBase: { schemas: { input: types<PreparedScope>() } },
					authorizingCreate: {},
					checkingCreateBaseline: {},
					validatingToken: {},
					creatingPasskey: {}
				}
			},
			encrypting: {
				states: {
					locking: {},
					authorizingEncrypt: {},
					checkingEncryptBaseline: {},
					encryptingSample: {}
				}
			},
			verifying: {
				states: {
					locking: {},
					authorizingVerify: {},
					checkingVerifyBaseline: {},
					verifyingSample: {}
				}
			},
			saving: {
				states: {
					locking: {},
					authorizingClaim: {},
					checkingClaimBaseline: {},
					claiming: {},
					sealing: {},
					authorizingSave: {},
					checkingSaveBaseline: {},
					persisting: { states: { working: {}, draining: {}, failing: {} } }
				}
			},
			readyToEncrypt: { id: 'bank-setup.readyToEncrypt' },
			readyToVerify: { id: 'bank-setup.readyToVerify' },
			readyToSave: { id: 'bank-setup.readyToSave' },
			complete: { id: 'bank-setup.complete', type: 'final' },
			cancelled: { id: 'bank-setup.cancelled', type: 'final' },
			settlingFailure: { id: 'bank-setup.settlingFailure' },
			failed: { type: 'final' }
		},
		actors,
		guards: {
			isDraining: (args: { value: import('xstate').StateValue }) =>
				matchesState({ saving: { persisting: 'draining' } }, args.value)
		}
	})
	const failure = (context: Context, error: unknown, enqueue: (effect: () => void) => void) => {
		enqueue(() => context.base?.trace.failed('setup.failed', error))
		return { error, accessUrl: undefined, token: undefined }
	}
	return workflow.createMachine({
		id: 'bank-setup',
		initial: 'creating',
		context: ({ input }) => ({
			credentialFingerprint: bankEnvironment(observe()).credentialFingerprint,
			identity: { userId: observe().userId, organizationId: observe().organizationId },
			token: input.token,
			base: undefined,
			material: undefined,
			accessUrl: undefined,
			error: undefined,
			settlement: 'notStarted',
			completion: undefined
		}),
		output: ({ context }) => required(context.completion),
		on: {
			CANCEL: { target: '.cancelled' },
			CREDENTIAL_CHANGED: (args) => {
				if (!(args.context.credentialFingerprint !== args.event.fingerprint)) return
				return { target: '.cancelled' }
			}
		},
		states: {
			creating: {
				initial: 'locking',
				meta: { setupView: 'creating', setupStep: 1 },
				invoke: {
					src: 'lock',
					input: ({ context }) => ({
						ownerId: context.identity.userId,
						organizationId: context.identity.organizationId
					}),
					onError: (args, enq) => {
						const { context, event } = args
						return {
							target: '#bank-setup.settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				},
				on: {
					LOCK_FAILED: (args, enq) => {
						const { context, event } = args
						return {
							target: '#bank-setup.settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				},
				states: {
					locking: { on: { LOCK_ACQUIRED: { target: 'preparing' } } },
					preparing: {
						invoke: {
							src: 'prepare',
							input: ({ context }) => ({ identity: context.identity, requireConnection: false }),
							onDone: (args) => {
								const { event } = args
								if (!event.output.ok) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: event.output.ok ? undefined : event.output.error }
									}
								}
								return { target: 'allocatingBase', input: event.output.value }
							},
							onError: (args, enq) => {
								const { context, event } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(
										context,
										'error' in event ? event.error : new Error('failure'),
										enq
									)
								}
							}
						}
					},
					allocatingBase: {
						invoke: {
							id: 'startBase',
							src: 'startBase',
							input: ({ input }) => input,
							onDone: ({ event }) => ({
								target: 'authorizingCreate',
								context: { base: event.output }
							}),
							onError: ({ context, event }, enq) => ({
								target: '#bank-setup.settlingFailure',
								context: failure(context, event.error, enq)
							})
						}
					},
					authorizingCreate: {
						invoke: {
							src: 'authorize',
							input: ({ context }) => authorizationFor(context),
							onDone: (args) => {
								const { event } = args
								if (event.output.error !== undefined) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: event.output.error }
									}
								}
								return { target: 'checkingCreateBaseline' }
							},
							onError: (args, enq) => {
								const { context, event } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(
										context,
										'error' in event ? event.error : new Error('failure'),
										enq
									)
								}
							}
						}
					},
					checkingCreateBaseline: {
						invoke: {
							src: 'checkBaseline',
							input: ({ context }) => baseFor(context),
							onDone: (args) => {
								const { event } = args
								if (event.output.error !== undefined) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: event.output.error }
									}
								}
								return { target: 'validatingToken' }
							},
							onError: (args, enq) => {
								const { context, event } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(
										context,
										'error' in event ? event.error : new Error('failure'),
										enq
									)
								}
							}
						}
					},
					validatingToken: {
						invoke: {
							src: 'validateToken',
							input: ({ context }) => {
								if (!context.token) throw new Error('missing-token')
								return { token: context.token, base: baseFor(context) }
							},
							onDone: { target: 'creatingPasskey' },
							onError: (args, enq) => {
								const { context } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(context, new Error('invalid_setup_token'), enq)
								}
							}
						}
					},
					creatingPasskey: {
						invoke: {
							src: 'create',
							input: ({ context }) => baseFor(context),
							onDone: (args) => {
								return {
									target: '#bank-setup.readyToEncrypt',
									context: { material: { passkey: args.event.output } }
								}
							},
							onError: (args, enq) => {
								const { context } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(context, new Error('passkey_failure'), enq)
								}
							}
						}
					}
				}
			},
			encrypting: {
				initial: 'locking',
				meta: { setupView: 'encrypting', setupStep: 2 },
				invoke: {
					src: 'lock',
					input: ({ context }) => ({
						ownerId: context.identity.userId,
						organizationId: context.identity.organizationId
					}),
					onError: (args, enq) => {
						const { context, event } = args
						return {
							target: '#bank-setup.settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				},
				on: {
					LOCK_FAILED: (args, enq) => {
						const { context, event } = args
						return {
							target: '#bank-setup.settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				},
				states: {
					locking: { on: { LOCK_ACQUIRED: { target: 'authorizingEncrypt' } } },
					authorizingEncrypt: {
						invoke: {
							src: 'authorize',
							input: ({ context }) => authorizationFor(context),
							onDone: (args) => {
								const { event } = args
								if (event.output.error !== undefined) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: event.output.error }
									}
								}
								return { target: 'checkingEncryptBaseline' }
							},
							onError: (args, enq) => {
								const { context, event } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(
										context,
										'error' in event ? event.error : new Error('failure'),
										enq
									)
								}
							}
						}
					},
					checkingEncryptBaseline: {
						invoke: {
							src: 'checkBaseline',
							input: ({ context }) => baseFor(context),
							onDone: (args) => {
								const { event } = args
								if (event.output.error !== undefined) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: event.output.error }
									}
								}
								return { target: 'encryptingSample' }
							},
							onError: (args, enq) => {
								const { context, event } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(
										context,
										'error' in event ? event.error : new Error('failure'),
										enq
									)
								}
							}
						}
					},
					encryptingSample: {
						invoke: {
							src: 'encrypt',
							input: ({ context }) => {
								const material = required(context.material)
								if (!('passkey' in material)) throw new Error('invalid-machine-context')
								return { base: baseFor(context), passkey: material.passkey }
							},
							onDone: (args) => {
								return {
									target: '#bank-setup.readyToVerify',
									context: { material: { sample: args.event.output } }
								}
							},
							onError: (args, enq) => {
								const { context } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(context, new Error('passkey_failure'), enq)
								}
							}
						}
					}
				}
			},
			verifying: {
				initial: 'locking',
				meta: { setupView: 'verifying', setupStep: 3 },
				invoke: {
					src: 'lock',
					input: ({ context }) => ({
						ownerId: context.identity.userId,
						organizationId: context.identity.organizationId
					}),
					onError: (args, enq) => {
						const { context, event } = args
						return {
							target: '#bank-setup.settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				},
				on: {
					LOCK_FAILED: (args, enq) => {
						const { context, event } = args
						return {
							target: '#bank-setup.settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				},
				states: {
					locking: { on: { LOCK_ACQUIRED: { target: 'authorizingVerify' } } },
					authorizingVerify: {
						invoke: {
							src: 'authorize',
							input: ({ context }) => authorizationFor(context),
							onDone: (args) => {
								const { event } = args
								if (event.output.error !== undefined) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: event.output.error }
									}
								}
								return { target: 'checkingVerifyBaseline' }
							},
							onError: (args, enq) => {
								const { context, event } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(
										context,
										'error' in event ? event.error : new Error('failure'),
										enq
									)
								}
							}
						}
					},
					checkingVerifyBaseline: {
						invoke: {
							src: 'checkBaseline',
							input: ({ context }) => baseFor(context),
							onDone: (args) => {
								const { event } = args
								if (event.output.error !== undefined) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: event.output.error }
									}
								}
								return { target: 'verifyingSample' }
							},
							onError: (args, enq) => {
								const { context, event } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(
										context,
										'error' in event ? event.error : new Error('failure'),
										enq
									)
								}
							}
						}
					},
					verifyingSample: {
						invoke: {
							src: 'verify',
							input: ({ context }) => {
								const material = required(context.material)
								if (!('sample' in material)) throw new Error('invalid-machine-context')
								return { base: baseFor(context), sample: material.sample }
							},
							onDone: (args) => {
								return {
									target: '#bank-setup.readyToSave',
									context: { material: { seal: args.event.output } }
								}
							},
							onError: (args, enq) => {
								const { context } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(context, new Error('passkey_failure'), enq)
								}
							}
						}
					}
				}
			},
			saving: {
				initial: 'locking',
				meta: { setupView: 'saving', setupStep: 4 },
				invoke: {
					src: 'lock',
					input: ({ context }) => ({
						ownerId: context.identity.userId,
						organizationId: context.identity.organizationId
					}),
					onError: (args, enq) => {
						const { context, event } = args
						return {
							target: '#bank-setup.settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				},
				on: {
					CREDENTIAL_CHANGED: {},
					LOCK_FAILED: (args, enq) => {
						const { context, event } = args
						return {
							target: '#bank-setup.settlingFailure',
							context: failure(context, 'error' in event ? event.error : new Error('failure'), enq)
						}
					}
				},
				states: {
					locking: { on: { LOCK_ACQUIRED: { target: 'authorizingClaim' } } },
					authorizingClaim: {
						invoke: {
							src: 'authorize',
							input: ({ context }) => authorizationFor(context),
							onDone: (args) => {
								const { event } = args
								if (event.output.error !== undefined) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: event.output.error }
									}
								}
								return { target: 'checkingClaimBaseline' }
							},
							onError: (args, enq) => {
								const { context, event } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(
										context,
										'error' in event ? event.error : new Error('failure'),
										enq
									)
								}
							}
						}
					},
					checkingClaimBaseline: {
						invoke: {
							src: 'checkBaseline',
							input: ({ context }) => baseFor(context),
							onDone: (args) => {
								const { event } = args
								if (event.output.error !== undefined) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: event.output.error }
									}
								}
								return { target: 'claiming' }
							},
							onError: (args, enq) => {
								const { context, event } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(
										context,
										'error' in event ? event.error : new Error('failure'),
										enq
									)
								}
							}
						}
					},
					claiming: {
						invoke: {
							src: 'claim',
							input: ({ context }) => {
								if (!context.token) throw new Error('missing-token')
								return { token: context.token, base: baseFor(context) }
							},
							onDone: (args) => {
								return {
									target: 'sealing',
									context: { accessUrl: args.event.output, token: undefined }
								}
							},
							onError: (args, enq) => {
								const { context } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(context, new Error('claim_failure'), enq)
								}
							}
						}
					},
					sealing: {
						meta: { setupView: 'saving', setupStep: 4 },
						invoke: {
							src: 'seal',
							input: ({ context }) => {
								const material = required(context.material)
								if (!('seal' in material)) throw new Error('invalid-machine-context')
								return { seal: material.seal, accessUrl: required(context.accessUrl) }
							},
							onDone: (args) => {
								return {
									target: 'authorizingSave',
									context: { material: { encrypted: args.event.output }, accessUrl: undefined }
								}
							},
							onError: (args, enq) => {
								const { context } = args
								return {
									target: '#bank-setup.settlingFailure',
									context: failure(context, new Error('save_failure'), enq)
								}
							}
						}
					},
					authorizingSave: {
						meta: { setupView: 'saving', setupStep: 4 },
						invoke: {
							src: 'authorize',
							input: ({ context }) => authorizationFor(context),
							onDone: (args) => {
								if (args.event.output.error !== undefined) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: new Error('save_failure') }
									}
								}
								return { target: 'checkingSaveBaseline' }
							},
							onError: () => {
								return {
									target: '#bank-setup.settlingFailure',
									context: { error: new Error('save_failure') }
								}
							}
						}
					},
					checkingSaveBaseline: {
						invoke: {
							src: 'checkBaseline',
							input: ({ context }) => baseFor(context),
							onDone: (args) => {
								if (args.event.output.error !== undefined) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: new Error('save_failure') }
									}
								}
								return { target: 'persisting' }
							},
							onError: () => {
								return {
									target: '#bank-setup.settlingFailure',
									context: { error: new Error('save_failure') }
								}
							}
						}
					},
					persisting: {
						entry: () => {
							return { context: { settlement: 'unresolved' } }
						},
						initial: 'working',
						states: {
							working: {},
							draining: {
								entry: (args) => {
									return {
										context: ((args) => ({
											base: undefined,
											material: undefined,
											token: undefined,
											accessUrl: undefined
										}))(args)
									}
								},
								on: { CANCEL: {}, LOCK_FAILED: {}, CREDENTIAL_CHANGED: {} }
							},
							failing: {
								entry: (args) => {
									return {
										context: ((args) => ({
											base: undefined,
											material: undefined,
											token: undefined,
											accessUrl: undefined
										}))(args)
									}
								},
								on: { LOCK_FAILED: {}, CREDENTIAL_CHANGED: {} }
							}
						},
						on: {
							CANCEL: { target: '.draining' },
							LOCK_FAILED: (args, enq) => {
								const { context, event } = args
								return {
									target: '.failing',
									context: failure(
										context,
										'error' in event ? event.error : new Error('failure'),
										enq
									)
								}
							}
						},
						invoke: {
							src: 'persist',
							input: ({ context }) => {
								const material = required(context.material)
								if (!('encrypted' in material)) throw new Error('invalid-machine-context')
								const base = baseFor(context)
								return {
									scope: base.scope,
									baselineStatus: base.baselineStatus,
									encrypted: material.encrypted
								}
							},
							onDone: (args) => {
								const { event } = args
								if (matchesState({ saving: { persisting: 'draining' } }, args.value)) {
									return {
										target: '#bank-setup.cancelled',
										context: { settlement: event.output.settlement }
									}
								}
								if (matchesState({ saving: { persisting: 'failing' } }, args.value)) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { settlement: event.output.settlement }
									}
								}
								if (event.output.error !== undefined) {
									return {
										target: '#bank-setup.settlingFailure',
										context: { error: event.output.error, settlement: event.output.settlement }
									}
								}
								return {
									target: '#bank-setup.complete',
									context: { settlement: event.output.settlement }
								}
							},
							onError: (args, enq) => {
								const { context, event } = args
								if (args.guards.isDraining(args)) {
									return {
										target: '#bank-setup.cancelled',
										context: ((args) => ({ settlement: 'unresolved' }))(args)
									}
								}
								{
									let context = args.context
									let patch = {}
									patch = { ...patch, ...((args) => ({ settlement: 'unresolved' }))(args) }
									context = { ...args.context, ...patch }
									patch = {
										...patch,
										...failure(context, 'error' in event ? event.error : new Error('failure'), enq)
									}
									context = { ...args.context, ...patch }
									return { target: '#bank-setup.settlingFailure', context: patch }
								}
							}
						}
					}
				}
			},
			readyToEncrypt: {
				meta: { setupView: 'test-encryption', setupStep: 2 },
				on: { TEST_ENCRYPTION: { target: 'encrypting' } }
			},
			readyToVerify: {
				meta: { setupView: 'test-decryption', setupStep: 3 },
				on: { VERIFY_DECRYPTION: { target: 'verifying' } }
			},
			readyToSave: {
				meta: { setupView: 'save', setupStep: 4 },
				on: { SAVE_CONNECTION: { target: 'saving' } }
			},
			complete: {
				type: 'final',
				entry: (args) => {
					let context = args.context
					let patch = {}
					patch = { ...patch, ...((args) => ({ completion: { kind: 'complete' } }))(args) }
					context = { ...args.context, ...patch }
					patch = {
						...patch,
						...((args) => ({
							base: undefined,
							material: undefined,
							token: undefined,
							accessUrl: undefined
						}))({ ...args, context })
					}
					context = { ...args.context, ...patch }
					return { context: patch }
				}
			},
			cancelled: {
				type: 'final',
				entry: (args) => {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						...((args) => ({
							completion: (({ context }) => ({
								kind: 'cancelled',
								settlement: context.settlement
							}))(args)
						}))(args)
					}
					context = { ...args.context, ...patch }
					patch = {
						...patch,
						...((args) => ({
							base: undefined,
							material: undefined,
							token: undefined,
							accessUrl: undefined
						}))({ ...args, context })
					}
					context = { ...args.context, ...patch }
					return { context: patch }
				}
			},
			settlingFailure: {
				always: (args) => {
					const { context } = args
					if (context.error instanceof Error && context.error.message === 'disconnected') {
						return { target: 'cancelled' }
					}
					return { target: 'failed' }
				}
			},
			failed: {
				type: 'final',
				entry: (args) => {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						...((args) => ({
							completion: (({ context }) => ({
								kind: 'failed',
								error: context.error,
								settlement: context.settlement
							}))(args)
						}))(args)
					}
					context = { ...args.context, ...patch }
					patch = {
						...patch,
						...((args) => ({
							base: undefined,
							material: undefined,
							token: undefined,
							accessUrl: undefined
						}))({ ...args, context })
					}
					context = { ...args.context, ...patch }
					return { context: patch }
				}
			}
		}
	})
}
