import { afterEach, expect, it, vi } from 'vitest'
import { useSelector } from '@xstate/svelte'
import { selectLibraryView } from '../../machines/capture/library.js'
import { selectTagFormView } from '../../machines/capture/tag-form.js'
import type { WorkflowMessage } from '../../contracts/feedback.js'
import { openApplicationClient, type WorkerReply } from './client.js'
import { commandSchema } from './protocol.js'
import type { LibraryRender } from './views.js'
import { libraryViewSource, sameWorkflowMessage } from './view-source.js'

const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup()
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
	return { app, worker, failed, initial, binding, source: libraryViewSource(binding.client) }
}

it('supplies initial capability, suppresses unrelated updates and rereads after resubscription', () => {
	const f = fixture()
	const selected = useSelector(f.source, (view) => view.canAdd)
	const values: boolean[] = []
	const unsubscribe = selected.subscribe((value) => values.push(value))
	f.binding.update({ ...f.initial, hasMore: true })
	f.binding.update({ ...f.initial, canAdd: false })
	expect(values).toEqual([true, false])
	unsubscribe()
	f.binding.update(f.initial)
	expect(values).toEqual([true, false])
	const unsubscribeAgain = selected.subscribe((value) => values.push(value))
	expect(values).toEqual([true, false, true])
	unsubscribeAgain()
})

it('shares one source subscription and releases it without terminating the worker', () => {
	const f = fixture()
	const subscribe = vi.spyOn(f.source, 'subscribe')
	const selected = useSelector(f.source, (view) => view.canAdd)
	const first = selected.subscribe(() => {})
	const second = selected.subscribe(() => {})
	expect(subscribe).toHaveBeenCalledTimes(1)
	const subscription = subscribe.mock.results[0]?.value
	if (!subscription) throw new Error('Missing source subscription')
	const release = vi.spyOn(subscription, 'unsubscribe')
	first()
	expect(release).not.toHaveBeenCalled()
	second()
	expect(release).toHaveBeenCalledTimes(1)
	expect(f.worker.terminate).not.toHaveBeenCalled()
	f.binding.client.send({ type: 'ADD', url: 'https://example.invalid/article' })
	expect(f.worker.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({ type: 'LIBRARY', scope: f.initial.scope }),
		[]
	)
})

it('supports the public observer-object subscription form', () => {
	const f = fixture()
	const next = vi.fn()
	const subscription = f.source.subscribe({ next })
	expect(next).toHaveBeenCalledExactlyOnceWith(f.initial)
	subscription.unsubscribe()
	f.binding.update({ ...f.initial, canAdd: false })
	expect(next).toHaveBeenCalledTimes(1)
})

it('retains receipt-based mutation suppression until the actual client receives its receipt', () => {
	const f = fixture()
	const values: boolean[] = []
	const unsubscribe = useSelector(f.source, (view) => view.view.canOrganize).subscribe((value) =>
		values.push(value)
	)
	f.binding.client.send({
		type: 'ORGANIZE',
		request: { id: crypto.randomUUID(), field: 'trashed', value: false }
	})
	expect(values).toEqual([true, false])
	const message = commandSchema.parse(f.worker.postMessage.mock.lastCall?.[0])
	if (message.type !== 'LIBRARY') throw new Error('Missing library command')
	f.worker.onmessage?.({
		data: { type: 'RECEIVED', scope: f.initial.scope, requestId: message.requestId }
	})
	expect(values).toEqual([true, false, true])
	unsubscribe()
})

it('compares cloned messages by text and variant, including removal', () => {
	const f = fixture()
	const values: (WorkflowMessage | undefined)[] = []
	const unsubscribe = useSelector(
		f.source,
		(view) => view.view.captureFeedback,
		sameWorkflowMessage
	).subscribe((value) => values.push(value))
	for (const message of [
		{ text: 'First', variant: 'info' },
		{ text: 'First', variant: 'info' },
		{ text: 'First', variant: 'error' },
		{ text: 'Translated', variant: 'error' },
		undefined
	] satisfies (WorkflowMessage | undefined)[]) {
		f.binding.update({ ...f.initial, view: { ...f.initial.view, captureFeedback: message } })
	}
	expect(values).toEqual([
		undefined,
		{ text: 'First', variant: 'info' },
		{ text: 'First', variant: 'error' },
		{ text: 'Translated', variant: 'error' },
		undefined
	])
	unsubscribe()
})

it('isolates replaced A → B → A bindings and leaves shutdown with the application owner', () => {
	const f = fixture()
	const old = vi.fn()
	const unsubscribeOld = useSelector(f.source, (view) => view.canAdd).subscribe(old)
	unsubscribeOld()
	const b = f.app.library(render())
	const unsubscribeB = useSelector(libraryViewSource(b.client), (view) => view.canAdd).subscribe(
		() => {}
	)
	unsubscribeB()
	const newA = f.app.library(render())
	const current = vi.fn()
	const unsubscribeCurrent = useSelector(
		libraryViewSource(newA.client),
		(view) => view.canAdd
	).subscribe(current)
	f.binding.update({ ...f.initial, canAdd: false })
	expect(old).toHaveBeenCalledTimes(1)
	expect(current).toHaveBeenCalledExactlyOnceWith(true)
	unsubscribeCurrent()
	expect(f.worker.terminate).not.toHaveBeenCalled()
	f.app.close()
	expect(f.worker.terminate).not.toHaveBeenCalled()
	f.worker.onmessage?.({ data: { type: 'CLOSED' } })
	expect(f.worker.terminate).toHaveBeenCalledTimes(1)
})
