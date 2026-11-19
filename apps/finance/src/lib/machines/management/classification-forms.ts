import { setup, types, type SnapshotFrom } from 'xstate'
import {
	createScopedFormMachine,
	selectScopedFormObservation,
	selectScopedFormView
} from '../forms/scoped-form.js'
import {
	workerClassificationForms,
	classificationForm,
	type ClassificationForm,
	type WorkerFormCommand
} from '../../contracts/worker-forms.js'

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

/** One workspace-bound classification feature; scoped forms retain policy and writes. */
export function createClassificationOwner(options: {
	categories: ReturnType<typeof createCategoryManagementFormOptions>
	tags: ReturnType<typeof createTagManagementFormOptions>
}) {
	const createCategory = createScopedFormMachine(options.categories.create)
	const archiveCategory = createScopedFormMachine(options.categories.archive)
	const createTag = createScopedFormMachine(options.tags.create)
	const archiveTag = createScopedFormMachine(options.tags.archive)

	const logic = setup({
		schemas: {
			context: types<{ observation: ManagementObservation }>(),
			input: types<ManagementObservation>(),
			output: types<{ outcome: 'closed' }>(),
			events: {
				OBSERVE: types<{ observation: ManagementObservation }>(),
				CLASSIFICATION: types<{ form: ClassificationForm; command: WorkerFormCommand }>(),
				RESET: types(),
				SHUTDOWN: types()
			},
			children: {
				createCategory: types<import('xstate').ActorRefFrom<typeof createCategory>>(),
				archiveCategory: types<import('xstate').ActorRefFrom<typeof archiveCategory>>(),
				createTag: types<import('xstate').ActorRefFrom<typeof createTag>>(),
				archiveTag: types<import('xstate').ActorRefFrom<typeof archiveTag>>()
			}
		},
		actors: { createCategory, archiveCategory, createTag, archiveTag }
	}).createMachine({
		id: 'classification',
		initial: 'running',
		context: ({ input }) => ({ observation: input }),
		output: () => ({ outcome: 'closed' }),
		states: {
			running: {
				type: 'parallel',
				onDone: { target: 'closed' },
				states: {
					control: {
						initial: 'accepting',
						states: {
							accepting: {
								on: {
									'xstate.done.actor': ({ event }) =>
										classificationForm.options.some((form) => form === event.actorId)
											? { target: 'failed' }
											: undefined,
									OBSERVE: ({ event }, enq) => {
										for (const form of classificationForm.options) enq.sendTo(form, event)
										return { context: { observation: event.observation } }
									},
									CLASSIFICATION: ({ event }, enq) => enq.sendTo(event.form, event.command),
									RESET: ({ event }, enq) => {
										for (const form of classificationForm.options) enq.sendTo(form, event)
									},
									SHUTDOWN: ({ event }, enq) => {
										for (const form of classificationForm.options) enq.sendTo(form, event)
										return { target: 'draining' }
									}
								}
							},
							draining: { type: 'final' },
							// Keep sibling resource owners alive after an unexpected failure.
							failed: { id: 'classification-failed' }
						}
					},
					createCategory: {
						initial: 'active',
						invoke: {
							id: 'createCategory',
							src: 'createCategory',
							input: ({ context }) => context.observation,
							onSnapshot: {},
							onDone: { target: '.closed' },
							onError: { target: '#classification-failed' }
						},
						states: { active: {}, closed: { type: 'final' } }
					},
					archiveCategory: {
						initial: 'active',
						invoke: {
							id: 'archiveCategory',
							src: 'archiveCategory',
							input: ({ context }) => context.observation,
							onSnapshot: {},
							onDone: { target: '.closed' },
							onError: { target: '#classification-failed' }
						},
						states: { active: {}, closed: { type: 'final' } }
					},
					createTag: {
						initial: 'active',
						invoke: {
							id: 'createTag',
							src: 'createTag',
							input: ({ context }) => context.observation,
							onSnapshot: {},
							onDone: { target: '.closed' },
							onError: { target: '#classification-failed' }
						},
						states: { active: {}, closed: { type: 'final' } }
					},
					archiveTag: {
						initial: 'active',
						invoke: {
							id: 'archiveTag',
							src: 'archiveTag',
							input: ({ context }) => context.observation,
							onSnapshot: {},
							onDone: { target: '.closed' },
							onError: { target: '#classification-failed' }
						},
						states: { active: {}, closed: { type: 'final' } }
					}
				}
			},
			closed: { type: 'final' }
		}
	})
	/** Public projection of this owner's fixed invocations; no copied child lifecycle. */
	function selectReport(snapshot: SnapshotFrom<typeof logic>) {
		const createCategory = snapshot.children.createCategory?.getSnapshot()
		const archiveCategory = snapshot.children.archiveCategory?.getSnapshot()
		const createTag = snapshot.children.createTag?.getSnapshot()
		const archiveTag = snapshot.children.archiveTag?.getSnapshot()
		const observation = snapshot.context.observation
		const view =
			createCategory &&
			archiveCategory &&
			createTag &&
			archiveTag &&
			[createCategory, archiveCategory, createTag, archiveTag].every(
				(child) => selectScopedFormObservation(child) === observation
			)
				? workerClassificationForms.safeParse({
						createCategory: selectScopedFormView(createCategory, options.categories.create),
						archiveCategory: selectScopedFormView(archiveCategory, options.categories.archive),
						createTag: selectScopedFormView(createTag, options.tags.create),
						archiveTag: selectScopedFormView(archiveTag, options.tags.archive)
					})
				: undefined
		return {
			observation,
			failed: snapshot.matches({ running: { control: 'failed' } }) || view?.success === false,
			view: view?.success ? view.data : null
		}
	}
	return { logic, selectReport }
}
