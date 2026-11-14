import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import ArticleTags from './ArticleTags.svelte'
import type { LibraryClient } from '../runtime/worker/client.js'
import type { LibraryRender } from '../runtime/worker/views.js'
import type { LibraryArticle } from '../contracts/articles.js'
import { selectLibraryView } from '../machines/capture/library.js'
import { tagKey } from '../capture/tags.js'

const cleanups: (() => Promise<void>)[] = []
const dialogMethods = new Map<string, PropertyDescriptor | undefined>()
beforeEach(() => {
	// jsdom has no native modal lifecycle. These tests exercise tag feedback,
	// not browser modality, focus return or popover geometry.
	for (const name of ['showModal', 'close'])
		dialogMethods.set(name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name))
	Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
		configurable: true,
		value: function (this: HTMLDialogElement) {
			this.open = true
		}
	})
	Object.defineProperty(HTMLDialogElement.prototype, 'close', {
		configurable: true,
		value: function (this: HTMLDialogElement) {
			this.open = false
			this.dispatchEvent(new Event('close'))
		}
	})
})
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
	for (const [name, descriptor] of dialogMethods) {
		if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
		else Reflect.deleteProperty(HTMLDialogElement.prototype, name)
	}
	dialogMethods.clear()
	vi.restoreAllMocks()
})

function fixture(options: { error?: string; selected?: string; enabled?: boolean } = {}) {
	const row: LibraryArticle = {
		id: crypto.randomUUID(),
		title: 'Test article',
		url: 'https://example.invalid/article',
		readable: false,
		createdAt: '',
		failure: null,
		readingProgress: 0,
		tags: options.selected ? [{ key: tagKey(options.selected), name: options.selected }] : []
	}
	let view: LibraryRender = {
		scope: crypto.randomUUID(),
		rows: [row],
		total: 1,
		hasMore: false,
		listMessage: undefined,
		view: selectLibraryView(undefined),
		filters: { query: '', view: 'all', favorites: false, selectedTags: [] },
		canAdd: true,
		readerId: '',
		reader: undefined,
		readerProgress: undefined,
		readerRevision: '',
		tagArticle: row,
		article: undefined,
		sourceUrl: undefined,
		tagForm: {
			revision: 0,
			message: options.error ? { text: options.error, variant: 'error' } : undefined
		}
	}
	const listeners = new Set<(view: LibraryRender) => void>()
	const release = vi.fn()
	const tags = vi.fn<LibraryClient['tags']>()
	const client: LibraryClient = {
		getView: () => view,
		subscribe: (changed) => {
			listeners.add(changed)
			changed(view)
			return {
				unsubscribe: () => {
					listeners.delete(changed)
					release()
				}
			}
		},
		send: vi.fn(),
		more: vi.fn(),
		editTags: vi.fn(),
		tags,
		attach: () => () => {}
	}
	const target = document.createElement('div')
	document.body.append(target)
	const onclose = vi.fn()
	const component = mount(ArticleTags, {
		target,
		props: { actor: client, row, tags: [], enabled: options.enabled ?? true, open: true, onclose }
	})
	flushSync()
	let detached = false
	const detach = async () => {
		if (detached) return
		detached = true
		await unmount(component)
		target.remove()
	}
	cleanups.push(detach)
	const input = target.querySelector('input[type="text"]')
	if (!(input instanceof HTMLInputElement)) throw new Error('Missing tag field')
	const add = [...target.querySelectorAll('button')].find(
		(button) => button.textContent === 'Add tag'
	)
	if (!add) throw new Error('Missing add control')
	return {
		target,
		input,
		add,
		tags,
		row,
		release,
		detach,
		onclose,
		clearError: () => {
			view = { ...view, tagForm: { revision: 1, message: undefined } }
			for (const listener of listeners) listener(view)
			flushSync()
		}
	}
}

it('keeps a retained validation error out of the current chip announcement', async () => {
	const f = fixture({ error: 'Enter tag' })
	expect(f.input.getAttribute('aria-invalid')).toBe('true')
	f.input.value = 'Valid'
	f.input.dispatchEvent(new Event('input', { bubbles: true }))
	flushSync()
	expect(f.tags).toHaveBeenLastCalledWith({ type: 'RESET' })
	// Keep the old worker view until its asynchronous reset reply arrives.
	f.add.click()
	await tick()
	flushSync()
	expect(f.tags).toHaveBeenLastCalledWith({ type: 'SELECT', id: f.row.id, names: ['Valid'] })
	expect(f.target.querySelector('[role="status"]')?.textContent).toContain('tag Valid selected.')
	expect(f.target.querySelector('[role="status"]')?.textContent).not.toContain('Enter tag')
	f.clearError()
	expect(f.input.hasAttribute('aria-invalid')).toBe(false)
	await f.detach()
	expect(f.release).toHaveBeenCalledTimes(1)
})

it('keeps Unicode duplicate announcements local without issuing a membership change', async () => {
	const f = fixture({ selected: 'Straße' })
	f.input.value = 'STRASSE'
	f.input.dispatchEvent(new Event('input', { bubbles: true }))
	flushSync()
	f.add.click()
	await tick()
	flushSync()
	expect(f.target.querySelector('[role="status"]')?.textContent).toContain('already')
	expect(f.tags.mock.calls.some(([event]) => event.type === 'SELECT')).toBe(false)
})

it('does not submit readonly edits and resets the worker form on dialog closure', () => {
	const f = fixture({ enabled: false })
	expect(f.input.readOnly).toBe(true)
	expect(f.add.disabled).toBe(true)
	f.add.click()
	expect(f.tags).not.toHaveBeenCalled()
	f.target.querySelector('dialog')?.close()
	flushSync()
	expect(f.tags).toHaveBeenLastCalledWith({ type: 'RESET' })
	expect(f.onclose).toHaveBeenCalledTimes(1)
})
