<script lang="ts">
	import CategoryForm from '../classification/CategoryForm.svelte'
	import QueryContent from '../shared/QueryContent.svelte'
	import { m } from '#lib/paraglide/messages.js'
	import CategoryList from '../classification/CategoryList.svelte'
	import TagForm from '../classification/TagForm.svelte'
	import TagList from '../classification/TagList.svelte'
	import type { FinanceWorkerView, WorkerCommandScope } from '../../contracts/worker-application.js'
	import type { ClassificationForm, WorkerFormCommand } from '../../contracts/worker-forms.js'
	let {
		view,
		kind,
		onsend
	}: {
		view: FinanceWorkerView
		kind: 'category' | 'tag'
		onsend: (
			form: ClassificationForm,
			command: WorkerFormCommand,
			scope: WorkerCommandScope
		) => void
	} = $props()
	const data = $derived(view.classification)
	const scope = $derived(`${view.sessionRevision}:${view.selection.revision}`)
	function send(form: ClassificationForm, command: WorkerFormCommand) {
		onsend(form, command, view)
	}
	function submit(form: ClassificationForm, event: SubmitEvent) {
		event.preventDefault()
		if (event.currentTarget instanceof HTMLFormElement)
			send(form, { type: 'SUBMIT', values: Object.fromEntries(new FormData(event.currentTarget)) })
	}
	function reset(form: ClassificationForm, event: Event) {
		event.preventDefault()
		send(form, { type: 'RESET' })
	}
</script>

{#if data}
	{#if kind === 'category'}
		<QueryContent
			keepContentWhileLoading
			queries={[{ isLoading: data.countsLoading, error: null }]}
			loadingMessage={m['status.loading_subject']({ subject: m['nouns.category']({ count: 2 }) })}
			errorMessage={m['errors.load_subject']({ subject: m['nouns.category']({ count: 2 }) })}
		>
			<CategoryList
				categories={data.categories}
				counts={new Map(data.counts)}
				archivableCategoryIds={data.archivableCategoryIds}
				archiveView={data.forms.archiveCategory}
				onArchive={(categoryId) =>
					send('archiveCategory', {
						type: 'SUBMIT',
						values: { categoryId, organizationId: view.selection.workspaceId }
					})}
			/>
		</QueryContent>
		<CategoryForm
			{scope}
			view={data.forms.createCategory}
			onopen={() => send('createCategory', { type: 'OPEN' })}
			onsubmit={(event) => submit('createCategory', event)}
			onreset={(event) => reset('createCategory', event)}
			onRetryReadiness={() => send('createCategory', { type: 'RETRY_READINESS' })}
		/>
	{:else}
		<TagList
			tags={data.tags}
			categoryNames={new Map(data.categories.map((category) => [category.id, category.name]))}
			archivableTagIds={data.archivableTagIds}
			archiveView={data.forms.archiveTag}
			onArchive={(tagId) =>
				send('archiveTag', {
					type: 'SUBMIT',
					values: { tagId, organizationId: view.selection.workspaceId }
				})}
		/>
		<TagForm
			{scope}
			view={data.forms.createTag}
			categories={data.categoryOptions}
			onopen={() => send('createTag', { type: 'OPEN' })}
			onsubmit={(event) => submit('createTag', event)}
			onreset={(event) => reset('createTag', event)}
			onRetryReadiness={() => send('createTag', { type: 'RETRY_READINESS' })}
		/>
	{/if}
{/if}
