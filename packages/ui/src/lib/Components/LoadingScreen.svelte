<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLAttributes } from 'svelte/elements'
	import StatusMessage from './StatusMessage.svelte'

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
		variant?: 'loading' | 'error'
	} & (
			| { text: string; feedback?: Snippet }
			| { text?: string; feedback: Snippet }
		)

	let {
		text = '',
		feedback,
		variant = 'loading',
		class: className,
		...attributes
	}: Props = $props()
</script>

<div {...attributes} class={['loading-screen', className]}>
	<div class="content">
		{#if feedback}
			{@render feedback()}
		{:else}
			<StatusMessage {variant} {text} />
		{/if}
	</div>
</div>

<style>
	@property --dui-loading-screen-content-width {
		syntax: '*';
		inherits: true;
	}

	@property --dui-loading-screen-min-height {
		syntax: '*';
		inherits: true;
	}

	@property --dui-loading-screen-padding {
		syntax: '*';
		inherits: true;
	}

	.loading-screen {
		box-sizing: border-box;
		display: grid;
		place-items: center;
		min-block-size: var(--dui-loading-screen-min-height, 100dvh);
		padding: var(
			--dui-loading-screen-padding,
			var(--dui-space-md, var(--dui-spacing-lg, 1.5rem))
		);
		text-align: center;
	}

	.loading-screen[hidden]:not([hidden='until-found']) {
		display: none;
	}

	.content {
		display: grid;
		justify-items: center;
		min-inline-size: 0;
		max-inline-size: var(--dui-loading-screen-content-width, 40rem);
		overflow-wrap: anywhere;
	}
</style>
