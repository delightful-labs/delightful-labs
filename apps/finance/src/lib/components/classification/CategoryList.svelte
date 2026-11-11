<script lang="ts">
	import { EXPENSE } from '#lib/domain/transaction-kind.js'
	import { Button, ButtonContent, Table } from 'delightful-ui'
	import ArchiveIcon from 'tdesign-icons-svg/src/folder-minus.svg?component'
	import type { Category } from '#lib/schema.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import type { ManagementView } from '#lib/contracts/management-contract.js'
	import { formReasonText } from '#lib/forms/form-messages.js'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import ArchiveFilter, { type ArchiveFilterValue } from '../filters/ArchiveFilter.svelte'
	import { m } from '#lib/paraglide/messages.js'

	let {
		loading = false,
		categories,
		counts,
		archivableCategoryIds,
		archiveView,
		onArchive
	}: {
		loading?: boolean
		categories: readonly Category[]
		counts: ReadonlyMap<string, { transactions: number; tags: number }>
		archivableCategoryIds: readonly string[]
		archiveView: ManagementView<string>
		onArchive: (categoryId: string) => void
	} = $props()
	const numbers = $derived(new Intl.NumberFormat(getLocale()))
	let archiveFilter = $state<ArchiveFilterValue>('active')
	const visibleCategories = $derived(
		categories.filter(
			(row) =>
				archiveFilter === 'all' ||
				(archiveFilter === 'archived' ? !!row.archivedAt : !row.archivedAt)
		)
	)
</script>

<FormFeedback
	view={archiveView}
	subject={m['nouns.category']({ count: 1 })}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessage={m['forms.enter_subject']({
		subject: m['labels.subject_name']({ subject: m['nouns.category']({ count: 1 }) })
	})}
	successMessage={(name) =>
		m['status.archived_subject_name']({ subject: m['nouns.category']({ count: 1 }), name })}
	action="archive"
	section="result"
/>

<ArchiveFilter bind:value={archiveFilter} />

{#if loading || visibleCategories.length}
	<Table caption={m['nouns.category']({ count: 2 })}>
		<thead
			><tr>
				<th scope="col"
					>{m['labels.subject_name']({ subject: m['nouns.category']({ count: 1 }) })}</th
				>
				<th scope="col"
					>{m['labels.subject_type']({ subject: m['nouns.transaction']({ count: 1 }) })}</th
				>
				<th scope="col">{m['nouns.transaction']({ count: 2 })}</th>
				<th scope="col">{m['nouns.tag']({ count: 2 })}</th>
				<th scope="col">{m['labels.actions']()}</th>
			</tr></thead
		>
		<tbody>
			{#each visibleCategories as category (category.id)}
				<tr>
					<th scope="row">{category.name}</th>
					<td
						>{category.kind === EXPENSE
							? m['nouns.expense']({ count: 2 })
							: m['nouns.income']({ count: 1 })}</td
					>
					<td>{numbers.format(counts.get(category.id)?.transactions ?? 0)}</td>
					<td>{numbers.format(counts.get(category.id)?.tags ?? 0)}</td>
					<td
						>{#if archivableCategoryIds.includes(category.id)}
							<Button
								type="button"
								disabled={!archiveView.canSubmit}
								aria-label={m['actions.archive_subject']({ subject: category.name })}
								onclick={() => onArchive(category.id)}
							>
								<ButtonContent icon={ArchiveIcon} text={m['actions.archive_button']()} />
							</Button>
						{/if}</td
					>
				</tr>
			{/each}
		</tbody>
	</Table>
{:else}
	<p>{m['labels.no_subjects_yet']({ subjects: m['nouns.category']({ count: 2 }) })}</p>
{/if}
