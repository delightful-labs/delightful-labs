<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements'

	type Props = Omit<HTMLAttributes<HTMLElement>, 'aria-label'> & {
		label: string
	}

	let { label, children, class: className, ...attributes }: Props = $props()
</script>

<nav {...attributes} aria-label={label} class={['pagination', className]}>
	<ul>
		{@render children?.()}
	</ul>
</nav>

<style>
	@property --dui-pagination-gap {
		syntax: '*';
		inherits: true;
	}

	.pagination ul {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dui-pagination-gap, var(--dui-spacing-xxs, 0.25rem));
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
