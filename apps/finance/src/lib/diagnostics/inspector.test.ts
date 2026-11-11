import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createActor, createMachine, createAsyncLogic, waitFor } from 'xstate'

const fixture = vi.hoisted(() => ({ enabled: true, warn: vi.fn(), error: vi.fn() }))
vi.mock('$app/env', () => ({ browser: true }))
vi.mock('./logger.js', () => ({
	debugEnabled: fixture.enabled,
	createLogger: () => ({ warn: fixture.warn, error: fixture.error })
}))
const cleanup = new Set<() => void>()
let listener: ((event: MessageEvent<unknown>) => void) | undefined
const popup = { closed: false, focus: vi.fn(), postMessage: vi.fn() }
const open = vi.fn(() => popup)
beforeEach(() => {
	vi.resetModules()
	fixture.enabled = true
	fixture.warn.mockClear()
	fixture.error.mockClear()
	popup.closed = false
	popup.focus.mockClear()
	popup.postMessage.mockClear()
	open.mockReset()
	open.mockReturnValue(popup)
	listener = undefined
	vi.stubGlobal('window', {
		open,
		addEventListener: (_type: string, callback: (event: MessageEvent<unknown>) => void) => {
			listener = callback
		}
	})
})
afterEach(() => {
	for (const stop of cleanup) stop()
	cleanup.clear()
	vi.unstubAllGlobals()
})
function connect(source: unknown = popup, origin = 'https://stately.ai') {
	const event = new MessageEvent('message', { origin, data: { type: '@statelyai.connected' } })
	Object.defineProperty(event, 'source', { value: source })
	listener?.(event)
}
function wire() {
	return JSON.stringify(popup.postMessage.mock.calls)
}
it('inspects native v6 descendants without buffering private context, input or output', async () => {
	const { inspectActor, openStateInspector } = await import('./inspector.js')
	const child = createAsyncLogic({ run: async () => 'PRIVATE_OUTPUT' })
	const actor = createActor(
		createMachine({
			id: 'safe-parent',
			context: { secret: 'PRIVATE_CONTEXT' },
			initial: 'loading',
			states: {
				loading: {
					invoke: { src: child, input: { secret: 'PRIVATE_INPUT' }, onDone: { target: 'ready' } }
				},
				ready: {}
			}
		}),
		{ inspect: inspectActor }
	).start()
	cleanup.add(() => actor.stop())
	await waitFor(actor, (snapshot) => snapshot.matches('ready'))
	expect(open).not.toHaveBeenCalled()
	openStateInspector()
	connect()
	expect(popup.postMessage.mock.calls.length).toBeGreaterThan(1)
	expect(wire()).not.toMatch(/PRIVATE_(CONTEXT|INPUT|OUTPUT)/)
	expect(wire()).toContain('safe-parent')
	expect(popup.postMessage.mock.calls.every((call) => call[1] === 'https://stately.ai')).toBe(true)
})
it('keeps popup failures out of application startup and private errors out of transport', async () => {
	const { inspectActor, openStateInspector } = await import('./inspector.js')
	open.mockImplementation(() => {
		throw new Error('PRIVATE_POPUP_FAILURE')
	})
	const actor = createActor(createMachine({ initial: 'ready', states: { ready: {} } }), {
		inspect: inspectActor
	}).start()
	cleanup.add(() => actor.stop())
	expect(() => openStateInspector()).not.toThrow()
	expect(actor.getSnapshot().status).toBe('active')
	expect(fixture.warn).toHaveBeenCalledExactlyOnceWith('Inspector could not open')
	expect(wire()).not.toContain('PRIVATE_POPUP_FAILURE')
})
it('projects failed actor status without rejection payloads', async () => {
	const { inspectActor, openStateInspector } = await import('./inspector.js')
	const child = createAsyncLogic({
		run: async () => {
			throw new Error('PRIVATE_REJECTION')
		}
	})
	const actor = createActor(
		createMachine({
			initial: 'loading',
			states: { loading: { invoke: { src: child, onError: { target: 'failed' } } }, failed: {} }
		}),
		{ inspect: inspectActor }
	).start()
	cleanup.add(() => actor.stop())
	await waitFor(actor, (snapshot) => snapshot.matches('failed'))
	openStateInspector()
	connect()
	expect(wire()).toContain('failed')
	expect(wire()).not.toContain('PRIVATE_REJECTION')
})
it('never traverses a live context getter', async () => {
	const { inspectActor, openStateInspector } = await import('./inspector.js')
	const getter = vi.fn(() => {
		throw new Error('PRIVATE_GETTER')
	})
	class Resource {}
	const resource = new Resource()
	Object.defineProperty(resource, 'secret', { get: getter, enumerable: true })
	const context = { resource }
	const actor = createActor(createMachine({ context, initial: 'ready', states: { ready: {} } }), {
		inspect: inspectActor
	}).start()
	cleanup.add(() => actor.stop())
	openStateInspector()
	connect()
	expect(getter).not.toHaveBeenCalled()
	expect(wire()).not.toContain('PRIVATE_GETTER')
})
it('checks popup source and origin and replays current topology after many transitions', async () => {
	const { inspectActor, openStateInspector } = await import('./inspector.js')
	const actor = createActor(
		createMachine({
			id: 'current-state',
			initial: 'one',
			states: { one: { on: { NEXT: { target: 'two' } } }, two: { on: { NEXT: { target: 'one' } } } }
		}),
		{ inspect: inspectActor }
	).start()
	cleanup.add(() => actor.stop())
	for (let index = 0; index < 401; index++) actor.send({ type: 'NEXT' })
	openStateInspector()
	connect({}, 'https://stately.ai')
	connect(popup, 'https://foreign.example')
	expect(popup.postMessage).not.toHaveBeenCalled()
	connect()
	expect(wire()).toContain('two')
	expect(wire()).toContain('current-state')
	openStateInspector()
	expect(open).toHaveBeenCalledOnce()
	expect(popup.focus).toHaveBeenCalledOnce()
})
it('retains deep static hierarchy while omitting configuration payloads', async () => {
	const { inspectActor, openStateInspector } = await import('./inspector.js')
	type Tree = { initial?: string; states?: Record<string, Tree>; type?: 'final' }
	const tree = (depth: number): Tree =>
		depth
			? { initial: 'nested', states: { nested: tree(depth - 1) } }
			: { initial: 'deepest', states: { deepest: { type: 'final' } } }
	const actor = createActor(
		createMachine({
			id: 'deep',
			context: { data: 'PRIVATE_DEFINITION' },
			initial: 'outer',
			states: { outer: tree(25) }
		}),
		{ inspect: inspectActor }
	).start()
	cleanup.add(() => actor.stop())
	openStateInspector()
	connect()
	expect(wire()).toContain('deepest')
	expect(wire()).not.toContain('PRIVATE_DEFINITION')
})
