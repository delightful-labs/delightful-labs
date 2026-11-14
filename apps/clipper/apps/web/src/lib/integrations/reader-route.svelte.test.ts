import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import ReaderHost from './fixtures/ReaderHost.svelte'
import type { LibraryClient } from '../runtime/worker/client.js'
import type { LibraryRender } from '../runtime/worker/views.js'
import { selectLibraryView } from '../machines/capture/library.js'
import { selectTagFormView } from '../machines/capture/tag-form.js'

const cleanups: (() => void | Promise<void>)[] = []
beforeEach(() => {
	// jsdom substitutes only; native viewport, modality and popovers need browser coverage.
	vi.stubGlobal('matchMedia', () => ({
		matches: false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	}))
	for (const [prototype, name, method] of [
		[
			HTMLDialogElement.prototype,
			'showModal',
			function (this: HTMLDialogElement) {
				this.open = true
			}
		],
		[
			HTMLDialogElement.prototype,
			'close',
			function (this: HTMLDialogElement) {
				this.open = false
				this.dispatchEvent(new Event('close'))
			}
		],
		[HTMLElement.prototype, 'hidePopover', function () {}]
	] satisfies [object, string, () => void][]) {
		const original = Object.getOwnPropertyDescriptor(prototype, name)
		Object.defineProperty(prototype, name, { configurable: true, value: method })
		cleanups.push(() => {
			if (original) Object.defineProperty(prototype, name, original)
			else Reflect.deleteProperty(prototype, name)
		})
	}
})
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
	vi.unstubAllGlobals()
	window.getSelection()?.removeAllRanges()
})

function content(title = 'Saved document'): LibraryRender['reader'] {
	return {
		kind: 'available',
		document: { id: crypto.randomUUID(), title },
		progress: 0.2,
		text: 'Body of ' + title,
		asset: {
			kind: 'available',
			mediaType: 'text/html',
			bytes: new TextEncoder().encode('<h2>Section</h2><p>Body of ' + title + '</p>')
		}
	}
}

function fixture() {
	const id = crypto.randomUUID()
	const initialView = selectLibraryView(undefined)
	let current: LibraryRender = {
		scope: crypto.randomUUID(),
		rows: [],
		total: 0,
		hasMore: false,
		listMessage: undefined,
		view: {
			...initialView,
			canOrganize: true,
			readerExperience: { ...initialView.readerExperience, enabled: true }
		},
		filters: { query: '', view: 'all', favorites: false, selectedTags: [] },
		canAdd: true,
		readerId: '',
		reader: undefined,
		readerProgress: undefined,
		readerRevision: '',
		tagArticle: undefined,
		article: undefined,
		sourceUrl: 'https://example.invalid/original',
		tagForm: selectTagFormView(undefined)
	}
	const listeners = new Set<(view: LibraryRender) => void>()
	const order: string[] = []
	const leases: { root: HTMLElement; documentId: string; release: ReturnType<typeof vi.fn> }[] = []
	const send = vi.fn<LibraryClient['send']>((event) => order.push(event.type))
	const client: LibraryClient = {
		getView: () => current,
		subscribe: (changed) => {
			listeners.add(changed)
			changed(current)
			return {
				unsubscribe: () => {
					listeners.delete(changed)
				}
			}
		},
		send,
		more: vi.fn(),
		editTags: vi.fn(),
		tags: vi.fn(),
		attach: ({ root, scroller }, documentId) => {
			expect(scroller.tagName).toBe('MAIN')
			order.push('attach:' + documentId)
			const release = vi.fn(() => order.push('release:' + documentId + ':' + root.textContent))
			leases.push({ root, documentId, release })
			return release
		}
	}
	return {
		id,
		client,
		send,
		leases,
		order,
		get view() {
			return current
		},
		get subscriptions() {
			return listeners.size
		},
		publish: (view: LibraryRender) => {
			current = view
			for (const listener of listeners) listener(view)
			flushSync()
		}
	}
}

function attach(f: ReturnType<typeof fixture>) {
	const target = document.createElement('div')
	document.body.append(target)
	const component = mount(ReaderHost, { target, props: { client: f.client, id: f.id } })
	flushSync()
	let detached = false
	const detach = async () => {
		if (detached) return
		detached = true
		await unmount(component)
		target.remove()
	}
	cleanups.push(detach)
	return {
		target,
		detach,
		navigate: (owner: LibraryClient | undefined, id: string) => {
			component.navigate(owner, id)
			flushSync()
		}
	}
}

it('opens its route, renders worker feedback and attaches the available content document', () => {
	const f = fixture()
	const mounted = attach(f)
	expect(f.send).toHaveBeenCalledExactlyOnceWith({ type: 'OPEN', id: f.id })
	expect(f.subscriptions).toBe(2)
	f.publish({
		...f.view,
		readerId: f.id,
		view: { ...f.view.view, readerMessage: { text: 'Worker loading', variant: 'info' } }
	})
	expect(mounted.target.textContent).toContain('Worker loading')
	expect(f.leases).toHaveLength(0)
	const reader = content()
	f.publish({ ...f.view, reader, view: { ...f.view.view, readerMessage: undefined } })
	if (reader?.kind !== 'available') throw new Error('Missing fixture content')
	expect(mounted.target.querySelector('h1')?.textContent).toBe('Saved document')
	expect(mounted.target.textContent).not.toContain('Worker loading')
	expect(f.leases[0]?.documentId).toBe(reader.document.id)
	expect(reader.document.id).not.toBe(f.id)
	expect(mounted.target.querySelector('a[href="https://example.invalid/original"]')).not.toBeNull()
	const archive = [...mounted.target.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === 'Archive'
	)
	if (!archive) throw new Error('Missing archive button')
	archive.click()
	expect(f.send).toHaveBeenLastCalledWith({
		type: 'ORGANIZE',
		request: { id: f.id, field: 'status', value: 'archive' }
	})
})

it('rejects a previous route view on initial render and accepts a direct read without a list row', () => {
	const f = fixture()
	f.publish({
		...f.view,
		readerId: crypto.randomUUID(),
		reader: content('Previous route'),
		view: { ...f.view.view, readerMessage: { text: 'Previous reader failed', variant: 'error' } }
	})
	const mounted = attach(f)
	expect(mounted.target.textContent).not.toContain('Previous route')
	expect(mounted.target.textContent).not.toContain('Previous reader failed')
	expect(f.leases).toHaveLength(0)
	f.publish({ ...f.view, readerId: f.id, reader: content('Current route') })
	expect(mounted.target.querySelector('h1')?.textContent).toBe('Current route')
	expect(f.leases).toHaveLength(1)
})

it('preserves saved DOM, selection and its surface lease during progress and preference updates', () => {
	const f = fixture()
	const reader = content()
	f.publish({ ...f.view, readerId: f.id, reader })
	const mounted = attach(f)
	const paragraph = mounted.target.querySelector('article p')
	const text = paragraph?.firstChild
	if (!text) throw new Error('Missing saved text')
	const range = document.createRange()
	range.setStart(text, 0)
	range.setEnd(text, 4)
	window.getSelection()?.addRange(range)
	if (reader?.kind !== 'available') throw new Error('Missing fixture content')
	f.publish({
		...f.view,
		reader: { ...reader, progress: 0.75 },
		view: {
			...f.view.view,
			readerExperience: {
				...f.view.view.readerExperience,
				preferences: { ...f.view.view.readerExperience.preferences, size: 24, theme: 'dark' }
			}
		}
	})
	expect(mounted.target.querySelector('article p')).toBe(paragraph)
	expect(window.getSelection()?.toString()).toBe('Body')
	expect(mounted.target.textContent).toContain('75%')
	expect(document.documentElement.getAttribute('data-dui-theme')).toBe('dark')
	expect(f.leases).toHaveLength(1)
	expect(f.order[0]).toBe('OPEN')
	expect(f.leases[0]?.release).not.toHaveBeenCalled()
	const font = mounted.target.querySelector('select')
	if (!(font instanceof HTMLSelectElement)) throw new Error('Missing font selector')
	font.value = 'sans'
	font.dispatchEvent(new Event('change', { bubbles: true }))
	expect(f.send).toHaveBeenLastCalledWith({
		type: 'READER_EVENT',
		event: { type: 'CHANGE', change: { documentId: null, field: 'font', value: 'sans' } }
	})
})

it('releases the original surface before replacing saved content', () => {
	const f = fixture()
	f.publish({ ...f.view, readerId: f.id, reader: content('First') })
	const mounted = attach(f)
	const first = f.leases[0]
	if (!first) throw new Error('Missing original surface')
	f.publish({ ...f.view, reader: content('Replacement') })
	expect(first.release).toHaveBeenCalledOnce()
	expect(f.order).toContain('release:' + first.documentId + ':SectionBody of First')
	expect(f.leases).toHaveLength(2)
	const second = f.leases[1]
	if (!second) throw new Error('Missing replacement surface')
	expect(f.order.indexOf('release:' + first.documentId + ':SectionBody of First')).toBeLessThan(
		f.order.indexOf('attach:' + second.documentId)
	)
	expect(mounted.target.querySelector('h1')?.textContent).toBe('Replacement')
})

it('tears down unavailable content and displays the owning worker message', () => {
	const f = fixture()
	f.publish({ ...f.view, readerId: f.id, reader: content() })
	const mounted = attach(f)
	f.publish({
		...f.view,
		reader: { kind: 'unavailable' },
		view: { ...f.view.view, readerMessage: { text: 'Worker unavailable', variant: 'error' } }
	})
	expect(f.leases[0]?.release).toHaveBeenCalledOnce()
	expect(mounted.target.querySelector('article')).toBeNull()
	expect(mounted.target.textContent).toContain('Worker unavailable')
})

it('releases and closes the old reader without delivering late data or commands to another client', async () => {
	const a = fixture()
	a.publish({ ...a.view, readerId: a.id, reader: content('Account A') })
	const first = attach(a)
	await first.detach()
	expect(a.subscriptions).toBe(0)
	expect(a.leases[0]?.release).toHaveBeenCalledOnce()
	expect(a.order.findIndex((event) => event.startsWith('release:'))).toBeLessThan(
		a.order.indexOf('CLOSE_READER')
	)
	expect(a.send).toHaveBeenCalledWith({ type: 'READER_EVENT', event: { type: 'DETACH' } })
	const b = fixture()
	b.publish({ ...b.view, readerId: b.id, reader: content('Account B') })
	const second = attach(b)
	a.publish({ ...a.view, reader: content('Late old content') })
	expect(second.target.querySelector('h1')?.textContent).toBe('Account B')
	expect(a.leases).toHaveLength(1)
	expect(b.send).toHaveBeenCalledExactlyOnceWith({ type: 'OPEN', id: b.id })
	await second.detach()
	expect(b.subscriptions).toBe(0)
	expect(b.send).toHaveBeenCalledWith({ type: 'CLOSE_READER' })
})

it('rebinds a reused route across accounts and an unavailable client without detaching the new owner', () => {
	const a = fixture()
	a.publish({ ...a.view, readerId: a.id, reader: content('Account A') })
	const route = attach(a)
	const b = fixture()
	b.publish({ ...b.view, readerId: a.id, reader: content('Account B') })
	route.navigate(b.client, a.id)
	expect(route.target.querySelector('h1')?.textContent).toBe('Account B')
	expect(a.subscriptions).toBe(0)
	expect(b.subscriptions).toBe(2)
	expect(a.leases[0]?.release).toHaveBeenCalledOnce()
	expect(a.send).toHaveBeenCalledWith({ type: 'CLOSE_READER' })
	expect(b.send).toHaveBeenCalledExactlyOnceWith({ type: 'OPEN', id: a.id })
	expect(b.order[0]).toBe('OPEN')
	a.publish({ ...a.view, reader: content('Late A content') })
	expect(route.target.querySelector('h1')?.textContent).toBe('Account B')
	route.navigate(undefined, a.id)
	expect(document.documentElement.hasAttribute('data-dui-theme')).toBe(false)
	expect(route.target.querySelector('article')).toBeNull()
	expect(b.subscriptions).toBe(0)
	expect(b.leases[0]?.release).toHaveBeenCalledOnce()
	const fresh = fixture()
	fresh.publish({ ...fresh.view, readerId: a.id, reader: content('Fresh A binding') })
	route.navigate(fresh.client, a.id)
	expect(route.target.querySelector('h1')?.textContent).toBe('Fresh A binding')
	expect(fresh.send).toHaveBeenCalledExactlyOnceWith({ type: 'OPEN', id: a.id })
	expect(fresh.order[0]).toBe('OPEN')
})

it('closes and opens route IDs on the same client before admitting the next surface or feedback', () => {
	const f = fixture()
	f.publish({ ...f.view, readerId: f.id, reader: content('First route') })
	const route = attach(f)
	const nextId = crypto.randomUUID()
	route.navigate(f.client, nextId)
	expect(route.target.querySelector('article')).toBeNull()
	expect(f.leases[0]?.release).toHaveBeenCalledOnce()
	expect(f.send).toHaveBeenLastCalledWith({ type: 'OPEN', id: nextId })
	expect(f.order.indexOf('CLOSE_READER')).toBeLessThan(f.order.lastIndexOf('OPEN'))
	f.publish({
		...f.view,
		readerId: f.id,
		view: { ...f.view.view, readerMessage: { text: 'Stale route failure', variant: 'error' } }
	})
	expect(route.target.textContent).not.toContain('Stale route failure')
	expect(f.leases).toHaveLength(1)
	f.publish({
		...f.view,
		readerId: nextId,
		reader: content('Second route'),
		view: { ...f.view.view, readerMessage: undefined }
	})
	expect(route.target.querySelector('h1')?.textContent).toBe('Second route')
	expect(f.leases).toHaveLength(2)
	expect(f.subscriptions).toBe(2)
})

it('keeps settings open across viewport changes and binds dismissal to the current trigger', async () => {
	const media = Object.assign(new EventTarget(), { matches: false })
	vi.stubGlobal('matchMedia', () => media)
	const f = fixture()
	f.publish({ ...f.view, readerId: f.id, reader: content() })
	const route = attach(f)
	const toggle = route.target.querySelector('button[aria-label="Reading controls"]')
	if (!(toggle instanceof HTMLButtonElement)) throw new Error('Missing settings toggle')
	const id = toggle.getAttribute('aria-controls')
	const panel = id ? document.getElementById(id) : undefined
	const body = route.target.querySelector('article')?.parentElement
	if (!panel || !body) throw new Error('Missing reader panel')
	toggle.click()
	flushSync()
	expect(toggle.getAttribute('aria-expanded')).toBe('true')
	expect(Reflect.get(body, 'inert')).toBe(false)
	media.matches = true
	media.dispatchEvent(new Event('change'))
	flushSync()
	expect(toggle.getAttribute('aria-expanded')).toBe('true')
	expect(Reflect.get(body, 'inert')).toBe(true)
	const font = panel.querySelector('select')
	if (!font) throw new Error('Missing settings input')
	font.focus()
	font.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
	await tick()
	flushSync()
	expect(toggle.getAttribute('aria-expanded')).toBe('false')
	expect(Reflect.get(body, 'inert')).toBe(false)
	expect(document.activeElement).toBe(toggle)
})
