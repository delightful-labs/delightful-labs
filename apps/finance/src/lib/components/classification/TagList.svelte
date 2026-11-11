<script lang="ts">
	import { INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
	import { Button, ButtonContent, Table } from 'delightful-ui'
	import ArchiveIcon from 'tdesign-icons-svg/src/folder-minus.svg?component'
	import type { Tag } from '#lib/schema.js'
	import type { ManagementView } from '#lib/contracts/management-contract.js'
	import { formReasonText } from '#lib/forms/form-messages.js'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import ArchiveFilter, { type ArchiveFilterValue } from '../filters/ArchiveFilter.svelte'
	import { m } from '#lib/paraglide/messages.js'

	let {
		tags,
		categoryNames,
		archivableTagIds,
		archiveView,
		onArchive
	}: {
		tags: readonly Tag[]
		categoryNames: ReadonlyMap<string, string>
		archivableTagIds: readonly string[]
		archiveView: ManagementView<string>
		onArchive: (tagId: string) => void
	} = $props()
	let archiveFilter = $state<ArchiveFilterValue>('active')
	const visibleTags = $derived(
		tags.filter(
			(row) =>
				archiveFilter === 'all' ||
				(archiveFilter === 'archived' ? !!row.archivedAt : !row.archivedAt)
		)
	)
</script>

<FormFeedback
	view={archiveView}
	subject={m['nouns.tag']({ count: 1 })}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessage={m['forms.enter_subject']({
		subject: m['labels.subject_name']({ subject: m['nouns.tag']({ count: 1 }) })
	})}
	successMessage={(name) =>
		m['status.archived_subject_name']({ subject: m['nouns.tag']({ count: 1 }), name })}
	action="archive"
	section="result"
/>

{#if tags.length}
	<ArchiveFilter bind:value={archiveFilter} />
{/if}

{#if visibleTags.length}
	<Table caption={m['nouns.tag']({ count: 2 })}>
		<thead
			><tr>
				<th scope="col">{m['labels.subject_name']({ subject: m['nouns.tag']({ count: 1 }) })}</th>
				<th scope="col"
					>{m['labels.subject_type']({ subject: m['nouns.transaction']({ count: 1 }) })}</th
				>
				<th scope="col">{m['nouns.category']({ count: 1 })}</th>
				<th scope="col">{m['labels.actions']()}</th>
			</tr></thead
		>
		<tbody>
			{#each visibleTags as tag (tag.id)}
				<tr>
					<th scope="row">{tag.name}</th>
					<td
						>{tag.kind === EXPENSE
							? m['nouns.expense']({ count: 2 })
							: tag.kind === INCOME
								? m['nouns.income']({ count: 1 })
								: m['tags.kind_unassigned']()}</td
					>
					<td
						>{tag.categoryId
							? (categoryNames.get(tag.categoryId) ??
								m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) }))
							: m['labels.no_subject']({ subject: m['nouns.category']({ count: 1 }) })}</td
					>
					<td
						>{#if archivableTagIds.includes(tag.id)}
							<Button
								type="button"
								disabled={!archiveView.canSubmit}
								aria-label={m['actions.archive_subject']({ subject: tag.name })}
								onclick={() => onArchive(tag.id)}
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
	<p>{m['labels.no_subjects_yet']({ subjects: m['nouns.tag']({ count: 2 }) })}</p>
{/if}
