<script lang="ts">
	import type { Snippet } from 'svelte'
	import { getDb } from 'jazz-tools/svelte'
	import type { Category } from '#lib/schema.js'
	import type { ManagementObservation } from '#lib/contracts/management-contract.js'
	import { createScopedFormController } from '#lib/forms/forms.svelte.js'
	import { createManagementFormOptions } from '#lib/machines/management/management.js'
	import { categoryFormSchema } from '#lib/validation/categories.js'
	import { createCategory } from '#lib/data.js'
	import CategoryForm from '../classification/CategoryForm.svelte'

	let {
		kind,
		observe,
		children
	}: {
		kind: Category['kind']
		observe: () => ManagementObservation
		children: Snippet<[() => void, boolean, Category | undefined]>
	} = $props()
	const db = getDb()
	let categoryModal: CategoryForm | undefined = $state()
	const identityId = $derived(observe().identityId)
	const organizationId = $derived(observe().organizationId)
	const binding = $derived(observe().binding)
	const scope = $derived({ identityId, organizationId, binding })
	const categoryOptions = createManagementFormOptions({ binding: db, observe: () => observe() })({
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
		write: ({ request }) => {
			const organizationId = request.scope.organizationId
			if (!organizationId) throw new Error('Missing authorized workspace')
			return createCategory(db, organizationId, request.values.name, request.values.kind)
		}
	})
	const categoryController = createScopedFormController(categoryOptions)
	const createdCategory = $derived(
		categoryController.view.content.kind === 'success'
			? categoryController.view.content.value
			: undefined
	)
</script>

{@render children(() => categoryModal?.open(), categoryController.view.canOpen, createdCategory)}

<CategoryForm
	bind:this={categoryModal}
	{scope}
	fixedKind={kind}
	view={categoryController.view}
	onopen={categoryController.open}
	onsubmit={(event) => {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		categoryController.submitValues({
			name: new FormData(event.currentTarget).get('name'),
			kind
		})
	}}
	onreset={categoryController.reset}
	onRetryReadiness={categoryController.retryReadiness}
>
	{#snippet trigger()}{/snippet}
</CategoryForm>
