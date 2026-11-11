import { closeDevelopmentJazz } from '../src/lib/server/jazz-development.js'
import type { Jazz } from 'jazz-tools/backend'
import { isRunnableDevEnvironment, type Plugin, type ViteDevServer } from 'vite'
import { createActor, setup, toPromise, types, matchesState, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../src/lib/contracts/event-payload.js'

type Context = { server: ViteDevServer; backend?: Jazz; failed: boolean }
const actors = {
	load: createAsyncLogic<Jazz, ViteDevServer>({
		run: async ({ input }) => {
			// Use the same SSR module graph as hooks and routes, so local requests
			// share one SDK-owned backend rather than independent memory stores.
			const environment = input.environments.ssr
			if (!isRunnableDevEnvironment(environment))
				throw new Error('Jazz requires the SSR module runner')
			const module = await environment.runner.import('/src/lib/server/jazz.ts')
			return module.jazz
		}
	}),
	attach: createAsyncLogic({
		run: ({ input }: { input: Context }) => {
			if (!input.backend || !input.server.httpServer)
				throw new Error('Jazz dev backend unavailable')
			return input.backend.attach(input.server.httpServer)
		}
	}),
	close: createAsyncLogic({ run: ({ input }: { input: Jazz }) => closeDevelopmentJazz(input) })
}
const events0 = {
	CLOSE: types<EventPayload<{ type: 'CLOSE' } | { type: 'LISTEN' }, 'CLOSE'>>(),
	LISTEN: types<EventPayload<{ type: 'CLOSE' } | { type: 'LISTEN' }, 'LISTEN'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<(typeof actors)['load']>
			| import('xstate').OutputFrom<(typeof actors)['attach']>
			| import('xstate').OutputFrom<(typeof actors)['close']>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent
const lifecycle = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<ViteDevServer>(),
		children: {
			load: types<import('xstate').ActorRefFrom<(typeof actors)['load']>>(),
			attach: types<import('xstate').ActorRefFrom<(typeof actors)['attach']>>(),
			close: types<import('xstate').ActorRefFrom<(typeof actors)['close']>>()
		}
	},
	actors,
	guards: {
		loadingCancelled: (args: { value: import('xstate').StateValue }) =>
			matchesState({ loading: 'stopping' }, args.value),
		attachingCancelled: (args: { value: import('xstate').StateValue }) =>
			matchesState({ attaching: 'stopping' }, args.value),
		startupFailed: ({ context }: { context: Context }) => context.failed
	}
}).createMachine({
	id: 'finance-jazz-dev',
	context: ({ input }) => ({ server: input, failed: false }),
	initial: 'waiting',
	states: {
		waiting: { on: { LISTEN: { target: 'loading' }, CLOSE: { target: 'closed' } } },
		loading: {
			initial: 'active',
			states: { active: {}, stopping: {} },
			on: { CLOSE: { target: '.stopping' } },
			invoke: {
				src: 'load',
				input: ({ context }) => context.server,
				onDone: (args) => {
					if (args.guards.loadingCancelled(args)) {
						return {
							target: 'closing',
							context: ((args) => ({ backend: (({ event }) => event.output)(args) }))(args)
						}
					}
					return {
						target: 'attaching',
						context: ((args) => ({ backend: (({ event }) => event.output)(args) }))(args)
					}
				},
				onError: { target: 'failed' }
			}
		},
		attaching: {
			initial: 'active',
			states: { active: {}, stopping: {} },
			on: { CLOSE: { target: '.stopping' } },
			invoke: {
				src: 'attach',
				input: ({ context }) => context,
				onDone: (args) => {
					if (args.guards.attachingCancelled(args)) {
						return { target: 'closing' }
					}
					return { target: 'active' }
				},
				onError: (args) => {
					return { target: 'closing', context: ((args) => ({ failed: true }))(args) }
				}
			}
		},
		active: { on: { CLOSE: { target: 'closing' } } },
		closing: {
			invoke: {
				src: 'close',
				input: ({ context }) => context.backend!,
				onDone: (args) => {
					if (args.guards.startupFailed(args)) {
						return { target: 'failed' }
					}
					return { target: 'closed' }
				},
				onError: { target: 'failed' }
			}
		},
		closed: { type: 'final' },
		failed: { type: 'final' }
	}
})
export function jazzDev(enabled: boolean): Plugin {
	return {
		name: 'finance-jazz-dev',
		async handleHotUpdate({ file, server }) {
			// The HTTP module and attached sockets must retain the same authority.
			// A backend definition change needs the normal close/start lifecycle.
			const backendFiles = [
				'/src/lib/server/jazz.ts',
				'/src/lib/schema.ts',
				'/src/lib/permissions.ts'
			]
			if (!enabled || !backendFiles.some((path) => file.endsWith(path))) return
			await server.restart()
			return []
		},
		async configureServer(server) {
			if (!enabled) return
			const owner = createActor(lifecycle, { input: server })
			const settled = toPromise(owner)
			void settled.catch(() => undefined)
			const http = server.httpServer
			if (!http) return
			http.once('listening', () => owner.send({ type: 'LISTEN' }))
			const native: { close(callback?: (error?: Error) => void): unknown } = http
			const close = native.close.bind(http)
			// Only this HTTP server owns this chart. Worker compilation and SSR
			// graph disposal must never close the application's backend.
			native.close = (callback) => {
				owner.send({ type: 'CLOSE' })
				return close((error) => {
					void settled.then(() =>
						callback?.(
							error ??
								(owner.getSnapshot().matches('failed')
									? new Error('Jazz backend shutdown failed')
									: undefined)
						)
					)
				})
			}
			owner.start()
		}
	}
}
