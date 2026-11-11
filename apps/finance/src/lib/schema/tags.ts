import { INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
import { schema as s } from 'jazz-tools'

export const tagsSchema = {
	tags: s.table(
		{
			organizationId: s.uuid(),
			name: s.string(),
			kind: s.enum(EXPENSE, INCOME),
			categoryId: s.uuid().optional(),
			archivedAt: s.timestamp().optional()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			category: s.rel('categories', 'categoryId'),
			transactionTags: s.reverse('transactionTags', 'tag')
		}
	)
}
