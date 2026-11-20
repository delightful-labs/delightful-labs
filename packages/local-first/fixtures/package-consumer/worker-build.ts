import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, relative } from 'node:path'
import type { UserConfig } from 'vite'
import {
	jazzWorkerOptions,
	resolveJazzWorkerAssets
} from 'delightful-local-first/backend/jazz/worker-build'

export function workerBuild() {
	return jazzWorkerOptions() satisfies NonNullable<UserConfig['worker']>
}

// Exercise the packed Node export using the consuming module's native SDK identity.
const assets = resolveJazzWorkerAssets(import.meta.url)
const require = createRequire(import.meta.url)
const sdk = require.resolve('jazz-tools/package.json')
const sdkPackage: unknown = require('jazz-tools/package.json')
const wasmPackage: unknown = createRequire(assets.wasmEntry)('jazz-wasm/package.json')
assert.ok(sdkPackage && typeof sdkPackage === 'object' && 'version' in sdkPackage)
assert.ok(wasmPackage && typeof wasmPackage === 'object' && 'version' in wasmPackage)
assert.equal(wasmPackage.version, sdkPackage.version)
assert.ok(!relative(dirname(sdk), assets.brokerEntry).startsWith('..'))
await Promise.all(Object.values(assets).map((path) => access(path)))
