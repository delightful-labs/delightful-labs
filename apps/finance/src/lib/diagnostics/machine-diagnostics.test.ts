import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createActor, createMachine, setup, createAsyncLogic } from 'xstate'

const environment = vi.hoisted(() => ({ PUBLIC_DEBUG: 'true' }))
vi.mock('$app/env/public', () => environment)

beforeEach(() => {
	vi.resetModules()
	environment.PUBLIC_DEBUG = 'true'
	vi.spyOn(console, 'error').mockImplementation(() => {})
	vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

it('logs handled failures once, preserves context facts, and logs again after recovery', async () => {
	const { logMachineFailure } = await import('./machine-diagnostics.js')
	const actor = createActor(
		createMachine({
			id: 'workspace-initialization',
			context: {
				canWrite: true,
				attemptCount: 2,
				workspaceId: 'PRIVATE_ID',
				rows: ['PRIVATE_ROW'],
				draft: 'PRIVATE_DRAFT'
			},
			initial: 'ready',
			states: {
				ready: { on: { FAIL: { target: 'failed' } } },
				failed: {
					on: {
						TICK: {},
						RETRY: { target: 'ready' },
						CHANGE: () => {
							return { context: { attemptCount: 3 } }
						}
					}
				}
			}
		}),
		{ inspect: logMachineFailure }
	).start()
	expect(console.error).not.toHaveBeenCalled()
	actor.send({ type: 'FAIL' })
	actor.send({ type: 'TICK' })
	expect(console.error).toHaveBeenCalledTimes(1)
	expect(console.error).toHaveBeenLastCalledWith(
		'[state-machine] Machine entered an error state',
		expect.objectContaining({
			machine: 'workspace-initialization',
			states: ['failed'],
			errorAvailable: false,
			context: {
				canWrite: true,
				attemptCount: 2,
				hasWorkspaceId: true,
				rowsCount: 1,
				omittedFields: ['draft']
			}
		})
	)
	actor.send({ type: 'CHANGE' })
	expect(console.error).toHaveBeenCalledTimes(2)
	actor.send({ type: 'RETRY' })
	actor.send({ type: 'FAIL' })
	expect(console.error).toHaveBeenCalledTimes(3)
	expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('PRIVATE_')
	actor.stop()
})

it('observes rejected child actors and their handled parent error', async () => {
	const { logMachineFailure } = await import('./machine-diagnostics.js')
	const failure = Object.assign(new Error('Permissions head fetch failed'), {
		status: 401,
		code: 'unauthorized'
	})
	const machine = setup({
		actors: {
			fetch: createAsyncLogic({
				run: async () => {
					throw failure
				}
			})
		}
	}).createMachine({
		id: 'session-startup',
		initial: 'loading',
		states: {
			loading: {
				invoke: {
					src: 'fetch',
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			failed: {}
		}
	})
	const actor = createActor(machine, { inspect: logMachineFailure }).start()
	await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('failed'))
	expect(console.error).toHaveBeenCalledWith(
		'[state-machine] Machine entered an error state',
		expect.objectContaining({
			machine: 'session-startup',
			error: expect.objectContaining({
				message: 'Permissions head fetch failed',
				status: 401,
				code: 'unauthorized'
			})
		})
	)
	expect(console.error).toHaveBeenCalledWith(
		'[state-machine] Machine entered an error state',
		expect.objectContaining({ machine: 'invoked-actor', status: 'error' })
	)
	actor.stop()
})

it('captures initialization exceptions and unsuccessful final outcomes', async () => {
	const { logMachineFailure } = await import('./machine-diagnostics.js')
	const actor = createActor(
		createMachine({
			id: 'broken-startup',
			context: () => {
				throw new Error('Initialization failed')
			}
		}),
		{ inspect: logMachineFailure }
	)
	actor.subscribe({ error: () => {} })
	actor.start()
	expect(console.error).toHaveBeenCalledWith(
		'[state-machine] Machine entered an error state',
		expect.objectContaining({
			machine: 'broken-startup',
			status: 'error',
			error: expect.objectContaining({ message: 'Initialization failed' })
		})
	)
	const completed = createActor(
		createMachine({
			id: 'readiness',
			initial: 'completed',
			states: { completed: { type: 'final' } },
			output: { outcome: 'unavailable', reason: 'authorityUnavailable' }
		}),
		{ inspect: logMachineFailure }
	).start()
	expect(console.error).toHaveBeenCalledWith(
		'[state-machine] Machine entered an error state',
		expect.objectContaining({
			machine: 'readiness',
			result: { outcome: 'unavailable', reason: 'authorityUnavailable' }
		})
	)
	completed.stop()
})

it('does not log modeled denial or unavailability states as actor failures', async () => {
	const { logMachineFailure } = await import('./machine-diagnostics.js')
	const actor = createActor(
		createMachine({
			id: 'bank-availability',
			type: 'parallel',
			states: {
				access: {
					initial: 'denied',
					states: { denied: {} }
				},
				credential: {
					initial: 'unavailable',
					states: { unavailable: {} }
				}
			}
		}),
		{ inspect: logMachineFailure }
	).start()
	expect(console.error).not.toHaveBeenCalled()
	actor.stop()
})

it.each([false, true])(
	'distinguishes a saved failed sync from a history actor crash: %s',
	async (crash) => {
		const { logMachineFailure } = await import('./machine-diagnostics.js')
		const { bankHistoryMachine } = await import('../machines/bank-sync/history.js')
		const { collectReports } = await import('../machines/bank-sync/reports.fixture.js')
		const { connection } = await import('../machines/bank-sync/test-fixtures.js')
		const recipient = collectReports<import('../machines/bank-sync/history.js').HistoryEvent>()
		const machine = crash
			? bankHistoryMachine.provide({
					guards: {
						currentRevision: () => {
							throw new Error('History projection crashed')
						}
					}
				})
			: bankHistoryMachine
		const supervisor = createActor(
			createMachine({
				id: 'history-supervisor',
				invoke: {
					id: 'history',
					src: machine,
					input: { revision: 0, recipient },
					onError: (args, enq) => {
						enq(() => {})
					}
				}
			}),
			{
				inspect: logMachineFailure
			}
		).start()
		const actor = supervisor.getSnapshot().children.history
		if (!actor) throw new Error('Expected supervised history actor')
		actor.send({ type: 'CONNECTION_SELECTED', revision: 0, connectionId: connection.id })
		actor.send({
			type: 'HISTORY_CHANGED',
			revision: 0,
			records: [{ ...connection, lastSyncAt: new Date(), lastOutcome: 'failed' }]
		})
		if (crash)
			expect(console.error).toHaveBeenCalledWith(
				'[state-machine] Machine entered an error state',
				expect.objectContaining({ machine: 'bank-history', status: 'error' })
			)
		else {
			expect(actor.getSnapshot().matches('failed')).toBe(true)
			expect(console.error).not.toHaveBeenCalled()
		}
		supervisor.stop()
		recipient.stop()
	}
)

it('projects safe connection facts without reading arbitrary getters or user payloads', async () => {
	const { diagnosticContext } = await import('./machine-diagnostics.js')
	const getter = vi.fn(() => {
		throw new Error('Do not read')
	})
	class Database {
		getConfig() {
			return {
				appId: 'public-app-id',
				serverUrl: 'https://user:password@sync.example.com/private?token=PRIVATE_TOKEN',
				adminSecret: 'PRIVATE_SECRET'
			}
		}
	}
	const context = {
		db: new Database(),
		result: { outcome: 'partial', savedCount: 2 },
		accountId: 'PRIVATE_ACCOUNT',
		session: { token: 'PRIVATE_SESSION' }
	}
	Object.defineProperty(context, 'error', { enumerable: true, get: getter })
	expect(diagnosticContext(context)).toEqual({
		connection: {
			appId: 'public-app-id',
			serverConfigured: true,
			server: 'https://sync.example.com',
			environment: undefined
		},
		result: { outcome: 'partial', savedCount: 2 },
		hasAccountId: true,
		omittedFields: ['session']
	})
	expect(getter).not.toHaveBeenCalled()
})

it('redacts credentials, payloads and query data while retaining technical failure details', async () => {
	const { diagnosticError, diagnosticText, diagnosticEventType } =
		await import('./machine-diagnostics.js')
	const error = {
		name: 'NetworkError',
		message:
			'Unauthorized Bearer PRIVATE_TOKEN https://user:pass@sync.example.com/private?jwt=PRIVATE_JWT',
		status: 401,
		code: 'unauthorized',
		stack: 'Error\n at fetch (https://sync.example.com/src/client.ts:20:4?token=PRIVATE_QUERY)',
		cause: {
			message: 'Invalid admin secret',
			errors: [{ message: 'SELECT name FROM accounts WHERE name=PRIVATE_NAME' }]
		}
	}
	const result = diagnosticError(error)
	expect(result).toMatchObject({
		type: 'NetworkError',
		status: 401,
		code: 'unauthorized',
		message: 'Unauthorized [authorization redacted] https://sync.example.com',
		frames: ['at fetch (https://[token redacted]:20:4)'],
		cause: { message: 'Invalid admin secret', errors: [{ message: '[query redacted]' }] }
	})
	expect(JSON.stringify(result)).not.toContain('PRIVATE_')
	expect(diagnosticText('Payload {"name":"PRIVATE_NAME"}')).not.toContain('PRIVATE_NAME')
	expect(
		diagnosticText(
			'abandon ability able about above absent absorb abstract absurd abuse access accident'
		)
	).toBe('[text redacted]')
	expect(diagnosticEventType('xstate.error.actor.PRIVATE_ACCOUNT_ID')).toBe(
		'xstate.error.actor.[actor]'
	)
	const cycle = { cause: {} }
	cycle.cause = cycle
	expect(diagnosticError(cycle)).toMatchObject({ cause: { truncated: true } })
})

it('disabled diagnostics do not inspect inputs or emit logs', async () => {
	environment.PUBLIC_DEBUG = 'false'
	const { logJazzInitializationFailure, logMachineFailure } =
		await import('./machine-diagnostics.js')
	const access = vi.fn(() => {
		throw new Error('Must not inspect')
	})
	const config = new Proxy({}, { getOwnPropertyDescriptor: access })
	logJazzInitializationFailure(config, config)
	const actor = createActor(createMachine({ initial: 'failed', states: { failed: {} } }), {
		inspect: logMachineFailure
	}).start()
	actor.stop()
	expect(access).not.toHaveBeenCalled()
	expect(console.error).not.toHaveBeenCalled()
	expect(console.warn).not.toHaveBeenCalled()
})

it('diagnostic collection failures preserve the original startup error boundary', async () => {
	const { logJazzInitializationFailure } = await import('./machine-diagnostics.js')
	const config = new Proxy(
		{},
		{
			getOwnPropertyDescriptor() {
				throw new Error('PRIVATE_PROXY_ERROR')
			}
		}
	)
	expect(() => logJazzInitializationFailure(config, new Error('PRIVATE_ERROR'))).not.toThrow()
	expect(console.error).toHaveBeenCalledExactlyOnceWith(
		'[jazz-startup] Jazz session initialization failed',
		{ diagnosticsAvailable: false }
	)
})
