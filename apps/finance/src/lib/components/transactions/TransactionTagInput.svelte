<script lang="ts">
	import type { Tag } from '#lib/schema.js'
	import { tick } from 'svelte'
	import { TagInput } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	let {
		organizationId,
		suggestions,
		initialTags = [],
		disabled = false
	}: {
		organizationId: Tag['organizationId']
		suggestions: readonly Tag['name'][]
		initialTags?: readonly Tag['name'][]
		disabled?: boolean
	} = $props()
	let editedTags = $state<string[]>()
	const selectedTags = $derived(editedTags ?? initialTags)
	let inputHost: HTMLDivElement | undefined = $state()
	$effect(() => {
		void selectedTags
		let active = true
		// TagInput updates hidden fields without a native input event.
		void tick().then(() => {
			if (active) inputHost?.dispatchEvent(new Event('input', { bubbles: true }))
		})
		return () => {
			active = false
		}
	})
</script>

{#key organizationId}
	<div bind:this={inputHost}>
		<TagInput
			name="tags"
			label={m['nouns.tag']({ count: 2 })}
			addLabel={m['actions.add_subject']({ subject: m['nouns.tag']({ count: 1 }) })}
			removeLabel={(name) => m['actions.remove_name']({ name })}
			selectedTagsLabel={m['labels.selected_subjects']({ subjects: m['nouns.tag']({ count: 2 }) })}
			addedMessage={(name) =>
				m['status.selected_subject_name']({ subject: m['nouns.tag']({ count: 1 }), name })}
			removedMessage={(name) =>
				m['status.removed_subject_name']({ subject: m['nouns.tag']({ count: 1 }), name })}
			duplicateMessage={(name) =>
				m['errors.already_selected_subject_name']({ subject: m['nouns.tag']({ count: 1 }), name })}
			suggestions={[...suggestions]}
			bind:value={() => [...selectedTags], (value) => (editedTags = value)}
			{disabled}
		/>
	</div>
{/key}
