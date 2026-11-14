import { afterEach, expect, it, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import AccountDrawerHost from './fixtures/AccountDrawerHost.svelte'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
	vi.unstubAllGlobals()
})

function fixture(mobile: boolean) {
	const media = Object.assign(new EventTarget(), { matches: mobile })
	vi.stubGlobal('matchMedia', () => media)
	const target = document.createElement('div')
	document.body.append(target)
	const component = mount(AccountDrawerHost, { target })
	flushSync()
	cleanups.push(async () => {
		await unmount(component)
		target.remove()
	})
	const panel = target.querySelector('aside')
	const trigger = target.querySelector('button[aria-controls]')
	const content = target.querySelector('section')
	if (!panel || !(trigger instanceof HTMLButtonElement) || !content)
		throw new Error('Missing account navigation')
	return {
		target,
		panel,
		trigger,
		content,
		resize: (mobile: boolean) => {
			media.matches = mobile
			media.dispatchEvent(new Event('change'))
			flushSync()
		}
	}
}

it('opens the desktop account panel after its component reference binds and keeps manual closure', () => {
	const f = fixture(false)
	expect(f.panel.getAttribute('aria-hidden')).toBe('false')
	expect(f.trigger.getAttribute('aria-expanded')).toBe('true')
	expect(f.target.textContent).toContain('Connected fixture')
	f.trigger.click()
	flushSync()
	expect(f.panel.getAttribute('aria-hidden')).toBe('true')
	expect(f.trigger.getAttribute('aria-expanded')).toBe('false')
})

it('starts mobile navigation closed, makes only its page content inert and restores focus on Escape', async () => {
	const f = fixture(true)
	expect(f.panel.getAttribute('aria-hidden')).toBe('true')
	f.trigger.click()
	flushSync()
	expect(Reflect.get(f.content, 'inert')).toBe(true)
	const link = f.panel.querySelector('a[href="/account"]')
	if (!(link instanceof HTMLAnchorElement)) throw new Error('Missing account link')
	link.focus()
	link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
	await tick()
	flushSync()
	expect(f.panel.getAttribute('aria-hidden')).toBe('true')
	expect(Reflect.get(f.content, 'inert')).toBe(false)
	expect(document.activeElement).toBe(f.trigger)
})

it('changes its default opening with the viewport and keeps a manually opened mobile panel open', () => {
	const f = fixture(false)
	f.resize(true)
	expect(f.panel.getAttribute('aria-hidden')).toBe('true')
	f.trigger.click()
	flushSync()
	expect(f.panel.getAttribute('aria-hidden')).toBe('false')
	f.resize(false)
	expect(f.panel.getAttribute('aria-hidden')).toBe('false')
	expect(Reflect.get(f.content, 'inert')).toBe(false)
})
