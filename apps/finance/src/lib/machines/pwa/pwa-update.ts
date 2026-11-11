import { createCallbackLogic, setup, types, createAsyncLogic } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type UpdateWorker = { postMessage: (message: { type: 'ACTIVATE_UPDATE' }) => void }
type UpdateRegistration = EventTarget & {
	waiting: UpdateWorker | null
	installing: ServiceWorker | null
}

export type UpdateEvent =
	| { type: 'READY'; worker: UpdateWorker }
	| { type: 'ACTIVATED' | 'ACCEPT' | 'LATER' | 'RETRY' | 'SHUTDOWN' | 'OBSERVER_FAILED' }

export type PwaUpdateView = 'hidden' | 'ready' | 'reload' | 'busy' | 'failed'

export function createPwaUpdateMachine(platform: {
	registration: () => Promise<UpdateRegistration | undefined>
	observe: (registration: UpdateRegistration, send: (event: UpdateEvent) => void) => () => void
	controller: () => UpdateWorker | null
	reload: () => void
}) {
	const actors = {
		registration: createAsyncLogic({ run: () => platform.registration() }),
		observe: createCallbackLogic<UpdateEvent, UpdateRegistration>(({ input, sendBack }) =>
			platform.observe(input, sendBack)
		),
		activate: createAsyncLogic<void, UpdateWorker>({
			run: async ({ input }) => {
				input.postMessage({ type: 'ACTIVATE_UPDATE' })
			}
		}),
		reload: createAsyncLogic({ run: async () => platform.reload() })
	}
	const events0 = {
		READY: types<EventPayload<UpdateEvent, 'READY'>>(),
		ACTIVATED: types<EventPayload<UpdateEvent, 'ACTIVATED'>>(),
		ACCEPT: types<EventPayload<UpdateEvent, 'ACCEPT'>>(),
		LATER: types<EventPayload<UpdateEvent, 'LATER'>>(),
		RETRY: types<EventPayload<UpdateEvent, 'RETRY'>>(),
		SHUTDOWN: types<EventPayload<UpdateEvent, 'SHUTDOWN'>>(),
		OBSERVER_FAILED: types<EventPayload<UpdateEvent, 'OBSERVER_FAILED'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['registration']>
				| import('xstate').OutputFrom<(typeof actors)['observe']>
				| import('xstate').OutputFrom<(typeof actors)['activate']>
				| import('xstate').OutputFrom<(typeof actors)['reload']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<{
				registration: UpdateRegistration | undefined
				worker: UpdateWorker | null
				originalController: UpdateWorker | null
			}>(),
			events: events0,
			children: {
				registration: types<import('xstate').ActorRefFrom<(typeof actors)['registration']>>(),
				observe: types<import('xstate').ActorRefFrom<(typeof actors)['observe']>>(),
				activate: types<import('xstate').ActorRefFrom<(typeof actors)['activate']>>(),
				reload: types<import('xstate').ActorRefFrom<(typeof actors)['reload']>>()
			}
		},
		actors
	}).createMachine({
		id: 'pwa-update',
		context: () => ({
			registration: undefined,
			worker: null,
			originalController: platform.controller()
		}),
		initial: 'discovering',
		on: { SHUTDOWN: { target: '.cancelled' } },
		states: {
			discovering: {
				invoke: {
					src: 'registration',
					onDone: (args) => {
						const { event } = args
						if (event.output !== undefined) {
							return { target: 'watching', context: { registration: event.output } }
						}
						return { target: 'unsupported' }
					},
					onError: { target: 'unavailable' }
				}
			},
			watching: {
				invoke: {
					src: 'observe',
					input: ({ context }) => {
						if (!context.registration) throw new Error('Missing service worker registration')
						return context.registration
					},
					onError: { target: '#pwa-update.unavailable' }
				},
				initial: 'idle',
				on: {
					OBSERVER_FAILED: { target: '#pwa-update.unavailable' },
					READY: (args) => {
						const { event } = args
						if (!(args.context.worker !== event.worker)) return
						return { target: '.ready', context: { worker: event.worker } }
					},
					ACTIVATED: { target: '.reloadReady' }
				},
				states: {
					idle: {},
					ready: { on: { ACCEPT: { target: 'checking' }, LATER: { target: 'dismissed' } } },
					dismissed: {},
					reloadReady: { on: { ACCEPT: { target: 'reloading' }, LATER: { target: 'dismissed' } } },
					checking: {
						always: (args) => {
							const { context } = args
							if (context.registration?.waiting != null) {
								return {
									target: 'activating',
									context: { worker: context.registration?.waiting ?? null }
								}
							}
							if (platform.controller() !== context.originalController) {
								return { target: 'reloading' }
							}
							return { target: 'failed' }
						}
					},
					activating: {
						initial: 'requesting',
						after: { 15000: { target: 'failed' } },
						on: { ACTIVATED: { target: 'reloading' }, READY: {} },
						states: {
							requesting: {
								invoke: {
									src: 'activate',
									input: ({ context }) => {
										if (!context.worker) throw new Error('Missing waiting worker')
										return context.worker
									},
									onDone: { target: 'waiting' },
									onError: { target: '#pwa-update.watching.failed' }
								}
							},
							waiting: {}
						}
					},
					reloading: {
						on: { READY: {}, ACTIVATED: {} },
						invoke: { src: 'reload', onError: { target: 'failed' } },
						after: { 15000: { target: 'failed' } }
					},
					failed: { on: { RETRY: { target: 'checking' }, LATER: { target: 'dismissed' } } }
				}
			},
			unavailable: { on: { RETRY: { target: 'discovering' }, LATER: { target: 'unsupported' } } },
			unsupported: { type: 'final' },
			cancelled: { type: 'final' }
		}
	})
}

export function selectPwaUpdateView(
	snapshot: SnapshotFrom<ReturnType<typeof createPwaUpdateMachine>>
): PwaUpdateView {
	if (snapshot.matches({ watching: 'ready' })) return 'ready'
	if (snapshot.matches({ watching: 'reloadReady' })) return 'reload'
	if (snapshot.matches({ watching: 'activating' }) || snapshot.matches({ watching: 'reloading' }))
		return 'busy'
	if (snapshot.matches({ watching: 'failed' }) || snapshot.matches('unavailable')) return 'failed'
	return 'hidden'
}
