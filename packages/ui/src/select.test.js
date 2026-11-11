import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import Select from './lib/Components/Inputs/Select.svelte'
import SelectBindings from '../tests/fixtures/SelectBindings.svelte'

describe('select server rendering', () => {
	it('links the visible label and forwards native attributes and option content', () => {
		const { body } = render(Select, {
			props: {
				label: 'Category & group',
				name: 'category',
				required: true,
				children: createRawSnippet(() => ({
					render: () => '<option value="work">Work</option>'
				}))
			}
		})
		const id = body.match(/<select\b[^>]*id="([^"]+)"/)?.[1]
		expect(id).toBeTruthy()
		expect(body).toContain(`for="${id}"`)
		expect(body).toContain('Category &amp; group')
		expect(body).toContain('name="category"')
		expect(body).toMatch(/<select\b[^>]*\brequired(?:=""|\s|>)/)
		expect(body).toContain('<option value="work">Work</option>')
	})

	it('forwards caller IDs, disabled state and multiple size', () => {
		const { body } = render(Select, {
			props: {
				label: 'Channels',
				id: 'channels',
				multiple: true,
				size: 3,
				disabled: true
			}
		})
		expect(body).toContain('for="channels"')
		expect(body).toContain('id="channels"')
		expect(body).toContain('size="3"')
		expect(body).toMatch(/<select\b[^>]*\bmultiple(?:=""|\s|>)/)
		expect(body).toMatch(/<select\b[^>]*\bdisabled(?:=""|\s|>)/)
	})

	it('server-renders value precedence and multiple defaults through compiled option snippets', () => {
		const { body } = render(SelectBindings)
		const selects = [
			...body.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/g)
		].map((match) => match[1])
		expect(selects).toHaveLength(2)
		expect(selects[0]).toMatch(/<option\b[^>]*value="other"[^>]*\bselected/)
		expect(selects[1]).toMatch(/<option\b[^>]*value="work"[^>]*\bselected/)
		const ids = [...body.matchAll(/<select\b[^>]*id="([^"]+)"/g)].map(
			(match) => match[1]
		)
		expect(new Set(ids).size).toBe(2)
		for (const id of ids) expect(body).toContain(`for="${id}"`)
	})
})
