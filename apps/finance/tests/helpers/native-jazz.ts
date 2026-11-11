import { nativeTestEndpoint } from './jazz-test-server.js'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { JazzClientConfig, JazzClient } from 'jazz-tools/backend'
import type { JazzSession } from 'jazz-tools/client'

// Raw-core research fixtures also open a service-owned backend session. This
// uses the SDK's native acquisition/admission, never browser credentials or a
// handwritten session. Production opens its authority with createJazz.
type NativeSessionConfig = Omit<JazzClientConfig, 'initial'> & {
	initial?: 'local-first' | { backendSecret: string }
}
const sdk = dirname(createRequire(import.meta.url).resolve('jazz-tools'))
const native: { openJazzSession(config: NativeSessionConfig): Promise<JazzSession<JazzClient>> } =
	await import(pathToFileURL(join(sdk, 'backend/create-jazz-session.js')).href)
export async function openNativeJazzSession(config: NativeSessionConfig) {
	const serverUrl = await nativeTestEndpoint(
		config.serverUrl,
		{
			app: config.app,
			permissions: config.permissions
		},
		typeof config.initial === 'object'
	)
	return native.openJazzSession({ ...config, serverUrl })
}
