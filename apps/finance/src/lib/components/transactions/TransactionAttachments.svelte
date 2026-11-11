<script module lang="ts">
	export type AttachmentImage = { id: string; fileId: string; name: string; source: string }
</script>

<script lang="ts">
	import { AvatarImageTile, Button } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	let {
		images,
		canEdit = false,
		removingIds = [],
		failedIds = [],
		onremove,
		onedit,
		editableIds = []
	}: {
		images: readonly AttachmentImage[]
		canEdit?: boolean
		removingIds?: readonly string[]
		failedIds?: readonly string[]
		onremove?: ((id: string) => void) | undefined
		onedit?: (id: string) => void
		editableIds?: readonly string[]
	} = $props()
</script>

{#each images as image (image.id)}
	<div class="item">
		<AvatarImageTile
			name={image.name}
			preview={image.source}
			downloadUrl={image.source}
			alt={m['images.preview_name']({ name: image.name })}
			infoLabel={m['labels.subject_details']({ subject: m['nouns.image']({ count: 1 }) })}
			closeLabel={m['actions.close']()}
			removeLabel={m['actions.remove_subject']({ subject: m['nouns.image']({ count: 1 }) })}
			removeAccessibleLabel={m['actions.remove_name']({ name: image.name })}
			disabled={removingIds.includes(image.id)}
			onremove={canEdit && onremove ? () => onremove?.(image.id) : undefined}
		>
			{#snippet actions(closePreview)}
				{#if canEdit && onedit}
					<Button
						type="button"
						disabled={!editableIds.includes(image.id)}
						onclick={() => {
							closePreview()
							onedit?.(image.id)
						}}
					>
						{m['actions.edit_subject']({ subject: m['nouns.image']({ count: 1 }) })}
					</Button>
				{/if}
			{/snippet}
		</AvatarImageTile>
		{#if canEdit && failedIds.includes(image.id)}
			<p role="status">{m['images.remove_failed']()}</p>
		{/if}
	</div>
{/each}

<style>
	.item {
		width: var(--dui-avatar-size, 8rem);
		max-width: 100%;
		min-width: 0;
	}
</style>
