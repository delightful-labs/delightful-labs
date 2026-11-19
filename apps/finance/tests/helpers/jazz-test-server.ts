import {
	startLocalJazzServer as startCore,
	startTestJazz,
	deploy as deployCore,
	type LocalJazzServerHandle,
	type StartLocalJazzServerOptions,
	type StartTestJazzOptions,
	type TestJazz,
	type DeployOptions
} from 'jazz-tools/testing'

type Definition = Pick<StartTestJazzOptions, 'app' | 'permissions'>
type RegisteredCore = {
	core: LocalJazzServerHandle
	app?: TestJazz
	open: (definition: Definition) => Promise<TestJazz>
}
// Test endpoint capabilities only. Native SDK utilities own servers, authority,
// admission, redeployment and shutdown; no user/session facade is fabricated.
const endpoints = new Map<string, RegisteredCore>()
const browserOrigins = new Set<string>()
export function allowTestBrowserOrigin(url: string) {
	const origin = new URL(url)
	if (!['localhost', '127.0.0.1'].includes(origin.hostname))
		throw new Error('Expected a loopback test origin')
	browserOrigins.add(origin.origin)
}

export async function startLocalJazzServer(
	options: Omit<StartLocalJazzServerOptions, 'schema' | 'permissions'> & {
		schema?: Definition['app']
		permissions?: Definition['permissions']
	}
): Promise<LocalJazzServerHandle> {
	const { schema, permissions, ...coreOptions } = options
	const core = await startCore(coreOptions)
	const entry: RegisteredCore = {
		core,
		async open(definition) {
			if (entry.app) return entry.app
			const app = await startTestJazz({
				core,
				...definition,
				jazz: { allowedOrigins: [...browserOrigins] }
			})
			entry.app = app
			endpoints.set(app.url, entry)
			return app
		}
	}
	endpoints.set(core.url, entry)
	try {
		if (schema !== undefined) {
			if (!permissions) throw new Error('Test permissions required')
			await entry.open({ app: schema, permissions })
		}
	} catch (error) {
		await core.stop()
		endpoints.delete(core.url)
		throw error
	}
	return {
		...core,
		get url() {
			return entry.app?.url ?? core.url
		},
		get port() {
			return Number(new URL(entry.app?.url ?? core.url).port)
		},
		async stop() {
			try {
				await entry.app?.stop()
			} finally {
				await core.stop()
			}
			endpoints.delete(core.url)
			if (entry.app) endpoints.delete(entry.app.url)
		}
	}
}

export async function deploy(options: DeployOptions) {
	const entry = endpoints.get(options.serverUrl)
	if (!entry) return deployCore(options)
	if (!entry.app) {
		const result = await deployCore({ ...options, serverUrl: entry.core.url })
		await entry.open({ app: options.app, permissions: options.permissions })
		return result
	}
	return entry.app.redeploy({ app: options.app, permissions: options.permissions })
}

export async function nativeTestEndpoint(url: string, definition: Definition, authority: boolean) {
	const entry = endpoints.get(url)
	if (!entry) return url
	if (authority) return entry.core.url
	return (await entry.open(definition)).url
}

/** The harness owns this authority until its core closes; no client/session is fabricated. */
export async function nativeTestAuthority(url: string, definition: Definition) {
	const entry = endpoints.get(url)
	if (!entry) throw new Error('Unregistered disposable authority')
	return (await entry.open(definition)).jazz.db
}
