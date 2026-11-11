import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { StatusMessage } from './lib/index.js'

/** @type {Array<'info' | 'success' | 'error'>} */
const compactVariants = ['info', 'success', 'error']

describe('status message server rendering', () => {
	it('renders visible escaped caller text with status semantics by default', () => {
		const { body } = render(StatusMessage, {
			props: { text: 'Saved <draft> & changes' }
		})
		expect(body).toContain('role="status"')
		expect(body).toContain('Saved &lt;draft> &amp; changes')
		expect(body).not.toContain('Loading')
	})

	it('exposes one live region while excluding the loading decoration', () => {
		const { body } = render(StatusMessage, {
			props: { variant: 'loading', text: 'Loading accounts' }
		})
		expect([...body.matchAll(/role="status"/g)]).toHaveLength(1)
		expect(body).toContain('role="presentation"')
		expect(body).toContain('aria-hidden="true"')
		expect([...body.matchAll(/Loading accounts/g)]).toHaveLength(1)
	})

	it('uses alert semantics for errors and respects caller role/attributes', () => {
		const { body } = render(StatusMessage, {
			props: { variant: 'error', text: 'Save failed' }
		})
		expect(body).toContain('role="alert"')
		const { body: overridden } = render(StatusMessage, {
			props: {
				variant: 'error',
				text: 'Save failed',
				role: 'presentation',
				id: 'feedback',
				hidden: true,
				'aria-live': 'off'
			}
		})
		expect(overridden).toContain('role="presentation"')
		expect(overridden).not.toContain('role="alert"')
		expect(overridden).toContain('id="feedback"')
		expect(overridden).toMatch(/<div\b[^>]*\bhidden(?:=""|\s|>)/)
		expect(overridden).toContain('aria-live="off"')
	})

	it.each(compactVariants)(
		'renders a decorative compact dot for %s',
		(variant) => {
			const { body } = render(StatusMessage, {
				props: { compact: true, variant, text: 'Current status' }
			})
			expect(body).toContain('compact')
			expect(body).toMatch(/<span\b[^>]*aria-hidden="true"[^>]*><\/span>/)
			expect(body).toContain(
				variant === 'error' ? 'role="alert"' : 'role="status"'
			)
			expect([...body.matchAll(/role="(?:status|alert)"/g)]).toHaveLength(1)
			expect([...body.matchAll(/Current status/g)]).toHaveLength(1)
			expect(body).not.toContain('compact="')
		}
	)

	it('retains one live region and a spinner rather than a dot for compact loading', () => {
		const { body } = render(StatusMessage, {
			props: { compact: true, variant: 'loading', text: 'Syncing changes' }
		})
		expect(body).toContain('compact')
		expect([...body.matchAll(/role="status"/g)]).toHaveLength(1)
		expect(body).toContain('role="presentation"')
		expect(body).not.toMatch(/<span\b[^>]*aria-hidden="true"/)
		expect([...body.matchAll(/Syncing changes/g)]).toHaveLength(1)
	})

	it('supports compact role overrides and forwards native attributes', () => {
		const { body } = render(StatusMessage, {
			props: {
				compact: true,
				variant: 'error',
				text: 'Background status',
				role: 'status',
				id: 'compact-feedback',
				hidden: true,
				'aria-live': 'polite'
			}
		})
		expect(body).toContain('role="status"')
		expect(body).not.toContain('role="alert"')
		expect(body).toContain('id="compact-feedback"')
		expect(body).toMatch(/<div\b[^>]*\bhidden(?:=""|\s|>)/)
		expect(body).toContain('aria-live="polite"')
	})

	it('keeps ordinary success messages free of the optional dot', () => {
		const { body } = render(StatusMessage, {
			props: { variant: 'success', text: 'Saved' }
		})
		expect(body).not.toMatch(/<span\b[^>]*aria-hidden="true"/)
	})
})
