import { app } from './schema.js'

/** Isolate the current schema for native policy fixtures. */
export function policySchema() {
	return { wasmSchema: structuredClone(app.wasmSchema) }
}
