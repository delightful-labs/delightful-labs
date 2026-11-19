import { nativeTestEndpoint } from './jazz-test-server.js'
import { createJazzClient, type JazzClientConfig } from 'jazz-tools/backend'
/** Ordinary test sessions use the SDK's public constructor. The test harness owns authority separately. */
export async function openNativeJazzSession(
	config: Omit<JazzClientConfig, 'permissions'> &
		Pick<import('jazz-tools/testing').StartTestJazzOptions, 'permissions'>
) {
	const serverUrl = await nativeTestEndpoint(
		config.serverUrl,
		{ app: config.app, permissions: config.permissions },
		false
	)
	return createJazzClient({ ...config, serverUrl })
}
