<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLAttributes } from 'svelte/elements'
	import LoadingScreen from './LoadingScreen.svelte'

	let {
		loading = true,
		text,
		variant = 'loading',
		children,
		class: className,
		...attributes
	}: Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'aria-busy'> & {
		/** Caller-owned pending state. Retained content becomes usable when false. */
		loading?: boolean
		text: string
		variant?: 'loading' | 'error'
		/** Omit for a standalone LoadingScreen, independent of loading. */
		children?: Snippet
	} = $props()
</script>

{#if children}
	<div
		{...attributes}
		class={['loading-content', className]}
		aria-busy={loading}
	>
		<div class="content" class:loading inert={loading} aria-hidden={loading}>
			{@render children()}
		</div>
		{#if loading}
			<div class="overlay">
				<LoadingScreen
					{text}
					{variant}
					style="--dui-loading-screen-min-height: auto"
				/>
			</div>
		{/if}
	</div>
{:else}
	<LoadingScreen {...attributes} class={className} {text} {variant} />
{/if}

<style>
	.loading-content {
		display: grid;
		min-inline-size: 0;
	}

	.loading-content[hidden]:not([hidden='until-found']) {
		display: none;
	}

	.content,
	.overlay {
		grid-area: 1 / 1;
		min-inline-size: 0;
	}

	.content {
		display: grid;
		align-content: start;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
	}

	.content.loading {
		opacity: 0.35;
	}

	.overlay {
		z-index: 1;
		display: grid;
		place-items: center;
	}
</style>
