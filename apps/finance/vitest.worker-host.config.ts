import { defineConfig } from 'vitest/config'

// Native host adapters have no Svelte/Paraglide dependency. Keep their focused
// verification separate from generated app configuration and the user's server.
export default defineConfig({
	tsconfig: './tsconfig.worker-host.json',
	test: {
		include: [
			'src/lib/runtime/worker/host-protocol.test.ts',
			'src/lib/runtime/worker/host-channel.test.ts',
			'src/lib/runtime/worker/host-drain.test.ts',
			'src/lib/runtime/worker/host-legacy.test.ts'
		],
		environment: 'node',
		expect: { requireAssertions: true }
	}
})
