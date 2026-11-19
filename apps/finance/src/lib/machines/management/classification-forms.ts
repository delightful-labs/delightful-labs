import { createManagementFormOptions } from './management.js'
import { categoryFormSchema, categoryArchiveSchema } from '../../validation/categories.js'
import { tagFormSchema, tagArchiveSchema } from '../../validation/tags.js'
import type { Category, Tag } from '../../queries.js'
import type { ManagementObservation } from '../../contracts/management-contract.js'
import type { z } from 'zod'
type Dependencies<Result, Values> = {
	binding: object
	observe: () => ManagementObservation
	create: (organizationId: string, values: Values) => Promise<Result>
	archive: (id: string) => Promise<unknown>
}
export function createCategoryManagementFormOptions(
	dependencies: Dependencies<Category, z.output<typeof categoryFormSchema>>
) {
	const formOptions = createManagementFormOptions(dependencies)

	const options = formOptions({
		schema: categoryFormSchema,
		successContent: 'replace',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: {
				kind: 'createCategory',
				name: request.values.name,
				categoryKind: request.values.kind
			}
		}),
		write: async ({ request }) => {
			const id = request.scope.organizationId
			if (id === null) throw new Error('Missing authorized workspace')
			return dependencies.create(id, request.values)
		}
	})
	const archiveOptions = formOptions({
		schema: categoryArchiveSchema,
		successContent: 'retain',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: {
				kind: 'archiveCategory',
				id: request.values.categoryId,
				organizationId: request.values.organizationId
			}
		}),
		write: async ({ request, observation }) => {
			const row = observation.facts.categories.find((row) => row.id === request.values.categoryId)
			if (!row) throw new Error('Missing authorized record')
			await dependencies.archive(row.id)
			return row.name
		}
	})
	return { create: options, archive: archiveOptions }
}

export function createTagManagementFormOptions(
	dependencies: Dependencies<Tag, z.output<typeof tagFormSchema>>
) {
	const formOptions = createManagementFormOptions(dependencies)

	const options = formOptions({
		schema: tagFormSchema,
		successContent: 'replace',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: {
				kind: 'createTag',
				name: request.values.name,
				tagKind: request.values.kind,
				categoryId: request.values.categoryId
			}
		}),
		write: async ({ request }) => {
			const id = request.scope.organizationId
			if (id === null) throw new Error('Missing authorized workspace')
			return dependencies.create(id, request.values)
		}
	})
	const archiveOptions = formOptions({
		schema: tagArchiveSchema,
		successContent: 'retain',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: {
				kind: 'archiveTag',
				id: request.values.tagId,
				organizationId: request.values.organizationId
			}
		}),
		write: async ({ request, observation }) => {
			const row = observation.facts.tags.find((row) => row.id === request.values.tagId)
			if (!row) throw new Error('Missing authorized record')
			await dependencies.archive(row.id)
			return row.name
		}
	})
	return { create: options, archive: archiveOptions }
}
