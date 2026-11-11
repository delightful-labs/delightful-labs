import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, prerender } from './+server.js'
import { m } from '#lib/paraglide/messages.js'
import { getLocale, getTextDirection } from '#lib/paraglide/runtime.js'

afterEach(() => vi.restoreAllMocks())

describe('localized install manifest', () => {
	it('reads app metadata from messages rather than duplicating English text', async () => {
		vi.spyOn(m, 'app.name').mockReturnValue(
			m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })
		)
		vi.spyOn(m, 'app.short_name').mockReturnValue(m['nouns.account']({ count: 1 }))
		vi.spyOn(m, 'app.description').mockReturnValue(m['profile.name_description']())
		await expect(GET().json()).resolves.toMatchObject({
			name: 'Workspace name',
			short_name: 'Account',
			description: 'Leave the name blank to use your account ID.'
		})
	})
	it('uses translated metadata and declares its language and direction', async () => {
		const response = GET()
		expect(response.headers.get('Content-Type')).toBe('application/manifest+json')
		await expect(response.json()).resolves.toMatchObject({
			name: m['app.name'](),
			short_name: m['app.short_name'](),
			description: m['app.description'](),
			lang: getLocale(),
			dir: getTextDirection(getLocale())
		})
	})
	it('preserves public offline installation URLs and build-time generation', async () => {
		expect(prerender).toBe(true)
		await expect(GET().json()).resolves.toMatchObject({
			id: '/',
			start_url: '/',
			scope: '/',
			display: 'standalone',
			theme_color: '#ffffff',
			background_color: '#ffffff',
			icons: [
				{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
				{
					src: '/web-app-manifest-192x192.png',
					sizes: '192x192',
					type: 'image/png',
					purpose: 'maskable'
				},
				{
					src: '/web-app-manifest-512x512.png',
					sizes: '512x512',
					type: 'image/png',
					purpose: 'maskable'
				}
			]
		})
	})
})
