import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import LibraryHost from './fixtures/LibraryHost.svelte'
import type { LibraryClient } from '../runtime/worker/client.js'
import type { LibraryRender } from '../runtime/worker/views.js'
import type { LibraryArticle } from '../contracts/articles.js'
import { selectLibraryView } from '../machines/capture/library.js'
import { selectTagFormView } from '../machines/capture/tag-form.js'
import { tagKey } from '../capture/tags.js'

const cleanups: (() => void | Promise<void>)[] = []
beforeEach(() => {
	// jsdom lacks native dialog/popover methods. These narrow substitutes allow
	// intent/DOM tests; they do not qualify browser modality or popup dismissal.
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
})

function article(title: string): LibraryArticle {
	return {
		id: crypto.randomUUID(),
		title,
		url: 'https://example.invalid/article',
		readable: true,
		createdAt: '',
		failure: null,
		readingProgress: 0
	}
}

function fixture(title = 'First article') {
	const first = article(title)
	const initialView = selectLibraryView(undefined)
	let current: LibraryRender = {
		scope: crypto.randomUUID(),
		rows: [first],
		total: 1,
		hasMore: true,
		listMessage: undefined,
		view: {
			...initialView,
			rows: [first],
			readable: { [first.id]: true },
			canOrganize: true,
			search: { ...initialView.search, enabled: true },
			emptyMessage: undefined
		},
		filters: { query: 'initial', view: 'all', favorites: false, selectedTags: [] },
		canAdd: true,
		reader: undefined,
		readerProgress: undefined,
		readerRevision: '',
		tagArticle: undefined,
		article: undefined,
		sourceUrl: undefined,
		tagForm: selectTagFormView(undefined)
	}
	const listeners = new Set<(view: LibraryRender) => void>()
	const send = vi.fn<LibraryClient['send']>()
	const more = vi.fn()
	const editTags = vi.fn<LibraryClient['editTags']>()
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
		more,
		editTags,
		tags: vi.fn(),
		attach: () => () => {}
	}
	const target = document.createElement('div')
	document.body.append(target)
	const component = mount(LibraryHost, { target, props: { client } })
	flushSync()
	let detached = false
	const detach = async () => {
		if (detached) return
		detached = true
		await unmount(component)
		target.remove()
	}
	cleanups.push(detach)
	const button = (name: string) => {
		const control = [...target.querySelectorAll('button')].find(
			(item) => item.textContent?.trim() === name
		)
		if (!control) throw new Error('Missing button: ' + name)
		return control
	}
	const search = target.querySelector('input[type="search"]')
	if (!(search instanceof HTMLInputElement)) throw new Error('Missing search input')
	return {
		first,
		target,
		search,
		button,
		send,
		more,
		editTags,
		detach,
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

it('renders the supplied initial view and sends search and filter intents to its scoped client', () => {
	const f = fixture()
	expect(f.target.querySelector('h1')?.textContent).toBe('Saved articles')
	expect(f.target.textContent).toContain('First article')
	expect(f.search.value).toBe('initial')
	f.search.value = 'updated'
	f.search.dispatchEvent(new Event('input', { bubbles: true }))
	expect(f.send).toHaveBeenLastCalledWith({ type: 'QUERY', query: 'updated' })
	f.button('Favorites').click()
	expect(f.send).toHaveBeenLastCalledWith({ type: 'FILTER', view: 'all', favorites: true })
	const later = f.target.querySelector('input[type="radio"][value="later"]')
	if (!(later instanceof HTMLInputElement)) throw new Error('Missing status filter')
	later.checked = true
	later.dispatchEvent(new Event('change', { bubbles: true }))
	expect(f.send).toHaveBeenLastCalledWith({ type: 'FILTER', view: 'later', favorites: false })
})

it('updates projected filters and forwards search retry without reconstructing its message', () => {
	const f = fixture()
	const key = tagKey('Topic')
	f.publish({
		...f.view,
		filters: {
			...f.view.filters,
			query: 'preserved',
			view: 'later',
			favorites: true,
			selectedTags: [key]
		},
		view: {
			...f.view.view,
			tags: [{ key, name: 'Topic' }],
			search: {
				...f.view.view.search,
				canRetry: true,
				message: { text: 'Worker search failure', variant: 'error' }
			}
		}
	})
	expect(f.search.value).toBe('preserved')
	expect(f.target.querySelector('input[value="later"]:checked')).not.toBeNull()
	expect(f.button('Favorites').getAttribute('aria-pressed')).toBe('true')
	const tag = f.target.querySelector('input[type="checkbox"]')
	if (!(tag instanceof HTMLInputElement)) throw new Error('Missing tag filter')
	expect(tag.checked).toBe(true)
	tag.click()
	expect(f.send).toHaveBeenLastCalledWith({ type: 'TAG_FILTER', keys: [] })
	expect(f.target.textContent).toContain('Worker search failure')
	f.button('Retry').click()
	expect(f.send).toHaveBeenLastCalledWith({ type: 'RETRY_SEARCH' })
})

it('forwards pagination and focuses the newly appended article', async () => {
	const f = fixture()
	f.button('Show articles').click()
	expect(f.more).toHaveBeenCalledTimes(1)
	const next = article('Next article')
	f.publish({
		...f.view,
		hasMore: false,
		view: {
			...f.view.view,
			rows: [f.first, next],
			readable: { [f.first.id]: true, [next.id]: true }
		}
	})
	await tick()
	flushSync()
	expect(document.activeElement?.textContent).toBe('Next article')
})

it('keeps a filtered-out article in its open tag editor and restores heading focus on closure', async () => {
	const f = fixture()
	f.button('tags').click()
	flushSync()
	expect(f.editTags).toHaveBeenLastCalledWith(f.first.id)
	f.publish({
		...f.view,
		tagArticle: { ...f.first, tags: [{ name: 'Pinned', key: tagKey('Pinned') }] },
		view: { ...f.view.view, rows: [] }
	})
	expect(f.target.querySelector('dialog[open]')?.textContent).toContain('Pinned')
	const dialog = f.target.querySelector('dialog[open]')
	if (!(dialog instanceof HTMLDialogElement)) throw new Error('Missing open tag editor')
	dialog.close()
	flushSync()
	await tick()
	expect(f.editTags).toHaveBeenLastCalledWith(undefined)
	expect(document.activeElement).toBe(f.target.querySelector('h1'))
})

it('releases every child subscription and does not display late data from a replaced client', async () => {
	const first = fixture('Old account article')
	expect(first.subscriptions).toBeGreaterThan(0)
	await first.detach()
	expect(first.subscriptions).toBe(0)
	const next = fixture('New account article')
	first.publish({
		...first.view,
		view: { ...first.view.view, rows: [article('Late old account')] }
	})
	expect(next.target.textContent).toContain('New account article')
	expect(next.target.textContent).not.toContain('Late old account')
})

it('forwards trash intent and focuses the heading when its last row disappears', async () => {
	const f = fixture()
	f.button('Move to Trash').click()
	expect(f.send).toHaveBeenLastCalledWith({
		type: 'ORGANIZE',
		request: { id: f.first.id, field: 'trashed', value: true }
	})
	f.publish({ ...f.view, rows: [], total: 0, hasMore: false, view: { ...f.view.view, rows: [] } })
	await tick()
	flushSync()
	expect(document.activeElement).toBe(f.target.querySelector('h1'))
})
