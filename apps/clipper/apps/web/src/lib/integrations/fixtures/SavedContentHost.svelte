<script lang="ts">
	import type { ComponentProps } from 'svelte'
	import SavedContent from '../SavedContent.svelte'
	import ReaderFootnotes from '../ReaderFootnotes.svelte'
	let { input }: { input: ComponentProps<typeof SavedContent> } = $props()
	export function update(next: ComponentProps<typeof SavedContent>) {
		input = next
	}
</script>

<ReaderFootnotes>
	{#snippet children(onlink, clear)}
		<SavedContent
			{...input}
			{onlink}
			onrelease={() => {
				input.onrelease?.()
				clear()
			}}
		/>
	{/snippet}
</ReaderFootnotes>
