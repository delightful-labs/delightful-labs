import { afterEach, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount, type ComponentProps } from 'svelte'
import SavedContentHost from './fixtures/SavedContentHost.svelte'
import type SavedContent from './SavedContent.svelte'
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
	window.getSelection()?.removeAllRanges()
})
function fixture() {
	const show = vi.fn(),
		hide = vi.fn()
	for (const [name, value] of [
		['showPopover', show],
		['hidePopover', hide]
	] satisfies [string, () => void][]) {
		const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
		Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value })
		cleanups.push(() => {
			if (previous) Object.defineProperty(HTMLElement.prototype, name, previous)
			else Reflect.deleteProperty(HTMLElement.prototype, name)
		})
	}
	const source = 'https://example.com/image.png'
	const ready = vi.fn(),
		release = vi.fn(),
		retry = vi.fn()
	let input: ComponentProps<typeof SavedContent> = {
		asset: {
			kind: 'available',
			mediaType: 'text/html',
			bytes: new TextEncoder().encode(
				'<p>Saved selection <a href="#fn1">1</a></p><p id="fn1">Footnote body</p><img alt="Saved image" data-clipper-image="' +
					encodeURIComponent(source) +
					'">'
			)
		},
		text: 'Saved selection',
		sourceUrl: 'https://example.com/article',
		imageViews: { [source]: { id: 'image', status: 'pending', retry: false } },
		onready: ready,
		onrelease: release,
		onretryimage: retry
	}
	const target = document.createElement('div')
	document.body.append(target)
	const component = mount(SavedContentHost, { target, props: { input } })
	flushSync()
	let disposed = false
	const dispose = async () => {
		if (disposed) return
		disposed = true
		await unmount(component)
		target.remove()
	}
	cleanups.push(dispose)
	return {
		target,
		ready,
		release,
		retry,
		show,
		hide,
		source,
		dispose,
		update: (next: Partial<typeof input>) => {
			input = { ...input, ...next }
			component.update(input)
			flushSync()
		}
	}
}
it('preserves saved DOM, selection and surface while live image status and callbacks change', () => {
	const f = fixture()
	const paragraph = f.target.querySelector('p')
	if (!paragraph?.firstChild) throw new Error('Missing saved content')
	const range = document.createRange()
	range.setStart(paragraph.firstChild, 0)
	range.setEnd(paragraph.firstChild, 5)
	window.getSelection()?.addRange(range)
	f.update({
		imageViews: {
			[f.source]: {
				id: 'image',
				status: 'failed',
				retry: true,
				message: { text: 'Image unavailable', variant: 'error' }
			}
		}
	})
	expect(f.target.querySelector('p')).toBe(paragraph)
	expect(window.getSelection()?.toString()).toBe('Saved')
	expect(f.ready).toHaveBeenCalledOnce()
	expect(f.release).not.toHaveBeenCalled()
	const retry = [...f.target.querySelectorAll('button')].find(
		(node) => node.textContent === 'Retry'
	)
	if (!retry) throw new Error('Missing retry')
	retry.click()
	expect(f.retry).toHaveBeenCalledWith('image')
	f.update({
		imageViews: {
			[f.source]: {
				id: 'image',
				status: 'ready',
				retry: false,
				url: 'https://example.com/cached.png'
			}
		}
	})
	expect(f.target.querySelector('img')?.alt).toBe('Saved image')
	expect(f.target.querySelector('p')).toBe(paragraph)
})
it('owns footnote preview within saved content and clears it before content replacement or disposal', async () => {
	const f = fixture()
	const link = f.target.querySelector('a[data-reader-footnote]')
	if (!(link instanceof HTMLAnchorElement)) throw new Error('Missing footnote link')
	link.click()
	flushSync()
	expect(f.show).toHaveBeenCalledWith({ source: link })
	expect(f.target.querySelector('[role="note"]')?.textContent).toContain('Footnote body')
	f.update({
		asset: {
			kind: 'available',
			mediaType: 'text/html',
			bytes: new TextEncoder().encode('<p>Replacement</p>')
		}
	})
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.ready).toHaveBeenCalledTimes(2)
	expect(f.target.querySelector('[role="note"]')?.textContent).not.toContain('Footnote body')
	expect(f.hide).toHaveBeenCalled()
	await f.dispose()
	expect(f.release).toHaveBeenCalledTimes(2)
})
