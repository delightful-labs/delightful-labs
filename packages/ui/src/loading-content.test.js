import { expect, test } from 'vitest'
import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import { LoadingContent } from './lib/index.js'

const children = createRawSnippet(() => ({
	render: () => '<button type="button">Retained control</button>'
}))

test('pending content stays mounted but inert and excluded from accessibility', () => {
	const { body } = render(LoadingContent, {
		props: { text: 'Loading <draft> & changes', children }
	})
	expect(body).toContain('Retained control')
	expect(body).toContain('aria-busy="true"')
	expect(body).toMatch(/<div\b[^>]*\binert\b[^>]*aria-hidden="true"/)
	expect(body).toContain('Loading &lt;draft> &amp; changes')
	expect([...body.matchAll(/role="status"/g)]).toHaveLength(1)
})

test('ready content has no inert ancestor or feedback', () => {
	const { body } = render(LoadingContent, {
		props: { loading: false, text: 'Loading draft', children }
	})
	expect(body).toContain('Retained control')
	expect(body).toContain('aria-busy="false"')
	expect(body).not.toMatch(/\binert\b/)
	expect(body).toContain('aria-hidden="false"')
	expect(body).not.toContain('Loading draft')
	expect(body).not.toContain('role="status"')
})

test('error overlays keep controls blocked and expose one alert', () => {
	const { body } = render(LoadingContent, {
		props: { text: 'Could not load draft', variant: 'error', children }
	})
	expect(body).toContain('Retained control')
	expect(body).toMatch(/\binert\b/)
	expect([...body.matchAll(/role="alert"/g)]).toHaveLength(1)
	expect(body).not.toContain('role="status"')
})

test('without children, standalone feedback remains visible independently of loading', () => {
	const { body } = render(LoadingContent, {
		props: { loading: false, text: 'Startup failed', variant: 'error' }
	})
	expect(body).toContain('Startup failed')
	expect(body).toContain('role="alert"')
	expect(body).not.toContain('aria-busy')
	expect(body).not.toMatch(/\binert\b/)
})

test.each([undefined, children])(
	'forwards native wrapper attributes in either composition',
	(content) => {
		const { body } = render(LoadingContent, {
			props: {
				text: 'Loading draft',
				children: content,
				id: 'draft-region',
				hidden: true,
				'aria-describedby': 'draft-help'
			}
		})
		expect(body).toContain('id="draft-region"')
		expect(body).toContain('aria-describedby="draft-help"')
		expect(body).toMatch(/<div\b[^>]*\bhidden(?:=""|\s|>)/)
	}
)
