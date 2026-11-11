import { json } from '@sveltejs/kit'
import { m } from '#lib/paraglide/messages.js'
import { getLocale, getTextDirection } from '#lib/paraglide/runtime.js'

// Generate a public manifest at build time, retaining the existing offline URL.
export const prerender = true

export function GET() {
	return json(
		{
			id: '/',
			name: m['app.name'](),
			short_name: m['app.short_name'](),
			description: m['app.description'](),
			lang: getLocale(),
			dir: getTextDirection(getLocale()),
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
		},
		{ headers: { 'Content-Type': 'application/manifest+json' } }
	)
}
