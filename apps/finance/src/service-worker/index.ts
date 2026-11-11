import { self } from '$app/service-worker'
import { version } from '$app/env'
import { assets, immutable, prerendered } from '$app/manifest'

const cachePrefix = 'delightful-finance-shell-'
const cacheName = `${cachePrefix}${version}`
const scopePath = new URL(self.registration.scope).pathname
const offlineShellPath = new URL('offline', self.registration.scope).pathname
const financeDetailPath =
	/^(?:expenses|income|transfers)\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
// Include all immutable assets, including the self-hosted Jost and Cascadia Code fonts.
const cachedPaths = new Set(
	[...immutable, ...assets, ...prerendered].map(
		({ path }) => new URL(path.replace(/^\//, ''), self.registration.scope).pathname
	)
)

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll([...cachedPaths])))
})

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key.startsWith(cachePrefix) && key !== cacheName)
						.map((key) => caches.delete(key))
				)
			)
	)
})

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url)
	const relativePath = url.pathname.startsWith(scopePath)
		? url.pathname.slice(scopePath.length)
		: ''
	const publicPath =
		event.request.mode === 'navigate' && financeDetailPath.test(relativePath)
			? offlineShellPath
			: url.pathname
	// Only the build's public shell/assets are cached. Jazz and auth requests pass through.
	if (
		event.request.method !== 'GET' ||
		url.origin !== self.location.origin ||
		!cachedPaths.has(publicPath)
	) {
		return
	}

	event.respondWith(
		caches.open(cacheName).then(async (cache) => {
			const cached = await cache.match(publicPath)
			return cached ?? fetch(event.request)
		})
	)
})

// Keep waiting until a user explicitly accepts the update in an app tab.
self.addEventListener('message', (event) => {
	const data: unknown = event.data
	if (
		typeof data === 'object' &&
		data !== null &&
		'type' in data &&
		data.type === 'ACTIVATE_UPDATE'
	) {
		event.waitUntil(self.skipWaiting())
	}
})
