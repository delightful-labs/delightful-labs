import { afterEach, expect, it, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import NativeView from './fixtures/NativeView.svelte'
import { selectLibraryView } from '../../machines/capture/library.js'
import { selectTagFormView } from '../../machines/capture/tag-form.js'
import type { WorkflowMessage } from '../../contracts/feedback.js'
import { openApplicationClient, type WorkerReply } from './client.js'
import { commandSchema } from './protocol.js'
import type { LibraryRender } from './views.js'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
	vi.unstubAllGlobals()
})

function render(scope = crypto.randomUUID()): LibraryRender {
	return {
		scope,
		rows: [],
		total: 0,
		hasMore: false,
		listMessage: undefined,
		view: { ...selectLibraryView(undefined), canOrganize: true },
		filters: { query: '', view: 'all', favorites: false, selectedTags: [] },
		canAdd: true,
		reader: undefined,
		readerProgress: undefined,
		readerRevision: '',
		tagArticle: undefined,
		article: undefined,
		sourceUrl: undefined,
		tagForm: selectTagFormView(undefined)
	}
}

function fixture() {
	const worker: {
		onmessage: ((event: { data: WorkerReply }) => void) | null
		onerror: (() => void) | null
		onmessageerror: (() => void) | null
		postMessage: ReturnType<typeof vi.fn<(message: unknown) => void>>
		terminate: ReturnType<typeof vi.fn<() => void>>
	} = {
		onmessage: null,
		onerror: null,
		onmessageerror: null,
		postMessage: vi.fn(),
		terminate: vi.fn()
	}
	vi.stubGlobal('Worker', function () {
		return worker
	})
	vi.stubGlobal(
		'window',
		Object.assign(new EventTarget(), { location: { href: 'https://example.invalid/' } })
	)
	vi.stubGlobal('navigator', { onLine: true })
	const failed = vi.fn()
	const app = openApplicationClient({
		appId: crypto.randomUUID(),
		serverUrl: 'https://example.invalid/jazz',
		publish: vi.fn(),
		recovery: vi.fn(),
		failed
	})
	cleanups.push(() => {
		app.close()
		worker.onmessage?.({ data: { type: 'CLOSED' } })
	})
	const initial = render()
	const binding = app.library(initial)
	return { app, worker, failed, initial, binding, client: binding.client }
}

function attach(client: ReturnType<typeof fixture>['client']) {
	const target = document.createElement('div')
	document.body.append(target)
	const component = mount(NativeView, { target, props: { client } })
	flushSync()
	let detached = false
	const detach = async () => {
		if (detached) return
		detached = true
		await unmount(component)
		target.remove()
	}
	cleanups.push(detach)
	return { target, detach }
}

it('renders initial values, updates and the current value after remount', async () => {
	const f = fixture()
	const first = attach(f.client)
	expect(first.target.querySelector('output')?.textContent).toBe('true')
	f.binding.update({ ...f.initial, hasMore: true, canAdd: false })
	flushSync()
	expect(first.target.querySelector('output')?.textContent).toBe('false')
	await first.detach()
	f.binding.update(f.initial)
	const second = attach(f.client)
	expect(second.target.querySelector('output')?.textContent).toBe('true')
	await second.detach()
})

it('uses one native subscription for multiple field reads and releases it on unmount', async () => {
	const f = fixture()
	const subscribe = vi.spyOn(f.client, 'subscribe')
	const mounted = attach(f.client)
	expect(subscribe).toHaveBeenCalledTimes(1)
	const subscription = subscribe.mock.results[0]?.value
	if (!subscription) throw new Error('Missing client subscription')
	const release = vi.spyOn(subscription, 'unsubscribe')
	await mounted.detach()
	expect(release).toHaveBeenCalledTimes(1)
	expect(f.worker.terminate).not.toHaveBeenCalled()
	f.client.send({ type: 'ADD', url: 'https://example.invalid/article' })
	expect(f.worker.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({ type: 'LIBRARY', scope: f.initial.scope }),
		[]
	)
})

it('renders receipt-based suppression until the actual client receives its receipt', async () => {
	const f = fixture()
	const mounted = attach(f.client)
	const value = () => mounted.target.querySelector('output[aria-label="Can organize"]')?.textContent
	expect(value()).toBe('true')
	f.client.send({
		type: 'ORGANIZE',
		request: { id: crypto.randomUUID(), field: 'trashed', value: false }
	})
	flushSync()
	expect(value()).toBe('false')
	const message = commandSchema.parse(f.worker.postMessage.mock.lastCall?.[0])
	if (message.type !== 'LIBRARY') throw new Error('Missing library command')
	f.worker.onmessage?.({
		data: { type: 'RECEIVED', scope: f.initial.scope, requestId: message.requestId }
	})
	flushSync()
	expect(value()).toBe('true')
	await mounted.detach()
})

it('renders cloned feedback, changed severity and wording, and removal without a comparator', async () => {
	const f = fixture()
	const mounted = attach(f.client)
	for (const message of [
		{ text: 'First', variant: 'info' },
		{ text: 'First', variant: 'info' },
		{ text: 'First', variant: 'error' },
		{ text: 'Translated', variant: 'error' },
		undefined
	] satisfies (WorkflowMessage | undefined)[]) {
		const previous = mounted.target.querySelector('[role="status"]')
		f.binding.update({ ...f.initial, view: { ...f.initial.view, captureFeedback: message } })
		flushSync()
		const status = mounted.target.querySelector('[role="status"]')
		expect(status?.textContent).toBe(message?.text)
		expect(status?.getAttribute('data-variant')).toBe(message?.variant)
		if (previous && message) expect(status).toBe(previous)
	}
	await mounted.detach()
})

it('isolates A → B → A mounts and leaves shutdown with the application owner', async () => {
	const f = fixture()
	const firstA = attach(f.client)
	await firstA.detach()
	const b = attach(f.app.library(render()).client)
	await b.detach()
	const current = attach(f.app.library(render()).client)
	f.binding.update({ ...f.initial, canAdd: false })
	flushSync()
	expect(current.target.querySelector('output')?.textContent).toBe('true')
	await current.detach()
	f.app.close()
	expect(f.worker.terminate).not.toHaveBeenCalled()
	f.worker.onmessage?.({ data: { type: 'CLOSED' } })
	expect(f.worker.terminate).toHaveBeenCalledTimes(1)
})
