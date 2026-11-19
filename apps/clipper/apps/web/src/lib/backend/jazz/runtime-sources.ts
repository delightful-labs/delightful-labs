import wasmUrl from '#jazz-wasm-binary?url'
import brokerWorkerUrl from '#jazz-broker-worker?sharedworker&url'
import { JAZZ_RUNTIME_VERSION } from '../../offline/runtime-version.js'

/** Every app and fixture realm must select the same native broker asset. */
export const jazzRuntimeSources = { wasmUrl, brokerWorkerUrl, wasmVersion: JAZZ_RUNTIME_VERSION }
