import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { Table } from './lib/index.js'

describe('native table rendering', () => {
	it('names the native table and scroll region from the escaped caption', () => {
		const { body } = render(Table, { props: { caption: 'Accounts & ledgers' } })
		const id = body.match(/<caption\b[^>]*id="([^"]+)"/)?.[1]
		expect(id).toBeTruthy()
		expect(body).toContain(`aria-labelledby="${id}"`)
		expect(body).toContain('Accounts &amp; ledgers')
		expect(body).toContain('role="region"')
		expect(body).toContain('tabindex="0"')
		expect(body).toContain('<table')
	})
	it('forwards table attributes and hides both the table and scroll region', () => {
		const { body } = render(Table, {
			props: {
				caption: 'Accounts',
				id: 'accounts',
				hidden: true
			}
		})
		expect(body).toContain('id="accounts"')

		expect([
			...body.matchAll(/<(?:div|table)\b[^>]*\bhidden(?:=""|\s|>)/g)
		]).toHaveLength(2)
	})
})
