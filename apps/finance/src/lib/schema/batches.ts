import { schema as s } from 'jazz-tools'

export const batchesSchema = {
	transactionBatches: s.table(
		{ organizationId: s.uuid(), name: s.string().optional() },
		{ organization: s.rel('organizations', 'organizationId') }
	),
	batchTemplates: s.table(
		{ organizationId: s.uuid(), name: s.string() },
		{ organization: s.rel('organizations', 'organizationId') }
	)
}
