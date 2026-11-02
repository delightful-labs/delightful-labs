<script lang="ts" module>
	export type AvatarImage = {
		avatarData?: Uint8Array | null | undefined
		avatarMimeType?: string | null | undefined
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte'

	let {
		avatarData,
		avatarMimeType,
		size = 32,
		alt,
		error
	}: AvatarImage & {
		size?: number
		alt: string
		error?: Snippet
	} = $props()

	let imageUrl = $state('')
	let imageFailed = $state(false)
	$effect(() => {
		imageFailed = false
		if (!avatarData || !avatarMimeType) {
			imageUrl = ''
			return
		}
		const url = URL.createObjectURL(
			new Blob([Uint8Array.from(avatarData)], { type: avatarMimeType })
		)
		imageUrl = url
		return () => URL.revokeObjectURL(url)
	})
</script>

{#if imageUrl && !imageFailed}
	<img src={imageUrl} {alt} width={size} height={size} onerror={() => (imageFailed = true)} />
{:else if imageFailed && error}
	{@render error()}
{/if}

<style>
	img {
		aspect-ratio: 1 / 1;
		object-fit: cover;
		border-radius: 50%;
		vertical-align: middle;
		flex-shrink: 0;
	}
</style>
