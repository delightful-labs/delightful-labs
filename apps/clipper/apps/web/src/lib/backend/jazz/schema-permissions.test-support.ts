import { app } from './schema.js'
import permissions from './permissions.js'

/** Historical fixtures use current policies only for tables present at that step. */
export function permissionsForSchema(schema: { wasmSchema: object }) {
	const tables = new Set(Object.keys(schema.wasmSchema))
	const historicalName =
		tables.has('documents') && !tables.has('contentRepresentations')
			? 'documents'
			: 'contentRepresentations'
	const renameReferences = (value: unknown): unknown => {
		if (value === 'contentRepresentations' && historicalName === 'documents') return 'documents'
		if (Array.isArray(value)) return value.map(renameReferences)
		if (value && typeof value === 'object') {
			return Object.fromEntries(
				Object.entries(value).map(([key, item]) => [key, renameReferences(item)])
			)
		}
		return value
	}
	return Object.fromEntries(
		Object.entries(permissions).flatMap(([table, policy]) => {
			const targetTable =
				historicalName === 'documents' && table === 'contentRepresentations' ? 'documents' : table
			return tables.has(targetTable)
				? [[targetTable, JSON.parse(JSON.stringify(renameReferences(policy)))]]
				: []
		})
	)
}

/** The SDK policy fixture deploys one schema without its migration graph. Give
 * both test peers that same isolated catalogue. Full app lenses are qualified
 * by migration.test.ts and the production offline tests instead. */
export function policySchema() {
	return { wasmSchema: structuredClone(app.wasmSchema) }
}
