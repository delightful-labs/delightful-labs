import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import RefreshIcon from 'tdesign-icons-svg/src/refresh.svg?component'
import { ButtonContent } from './lib/index.js'

describe('button content server rendering', () => {
	it('renders caller text and a decorative, unfocusable icon by default', () => {
		const { body } = render(ButtonContent, {
			props: { icon: RefreshIcon, text: 'Sync <accounts> & balances' }
		})
		expect(body).toContain('Sync &lt;accounts> &amp; balances')
		expect(body).toMatch(/<svg\b[^>]*aria-hidden="true"[^>]*focusable="false"/)
		expect(body).not.toContain('role="presentation"')
	})

	it('replaces the icon with a decorative spinner and preserves the label', () => {
		const { body } = render(ButtonContent, {
			props: { icon: RefreshIcon, text: 'Sync accounts', loading: true }
		})
		expect(body).not.toContain('<svg')
		expect(body).toMatch(
			/<span\b[^>]*aria-hidden="true"[^>]*>[\s\S]*role="presentation"/
		)
		expect(body.match(/Sync accounts/g)).toHaveLength(1)
		expect(body).not.toContain('role="status"')
	})
})
