<script lang="ts">
	import type { HTMLTableAttributes } from 'svelte/elements'

	type Props = HTMLTableAttributes & {
		caption: string
	}

	const generatedId = $props.id()
	const captionId = `${generatedId}-caption`
	let {
		caption,
		children,
		hidden,
		class: className,
		...attributes
	}: Props = $props()
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus this region for native scrolling.) -->
<div
	class="table-container"
	role="region"
	aria-labelledby={captionId}
	tabindex="0"
	{hidden}
>
	<table {...attributes} {hidden} class={['table', className]}>
		<caption id={captionId}>{caption}</caption>
		{@render children?.()}
	</table>
</div>

<style>
	@property --dui-table-cell-padding-block {
		syntax: '*';
		inherits: true;
	}

	@property --dui-table-cell-padding-inline {
		syntax: '*';
		inherits: true;
	}

	@property --dui-table-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-table-header-background-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-table-header-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-table-min-width {
		syntax: '*';
		inherits: true;
	}

	@property --dui-table-row-border-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-table-row-border-width {
		syntax: '<length> | thin | medium | thick';
		inherits: true;
		initial-value: 1px;
	}

	.table-container {
		min-inline-size: 0;
		max-inline-size: 100%;
		overflow: auto;
	}

	.table-container:focus-visible {
		outline: 2px solid var(--dui-color-focus, currentColor);
		outline-offset: 2px;
	}

	.table {
		--_dui-table-header-background: #000;
		--_dui-table-header-color: #fff;
		inline-size: 100%;
		min-inline-size: var(--dui-table-min-width, 100%);
		border-collapse: collapse;
		color: var(--dui-table-color, var(--dui-color-foreground, inherit));
	}

	:global([data-dui-theme='dark']) .table {
		--_dui-table-header-background: #fff;
		--_dui-table-header-color: #000;
	}

	.table :global(thead) {
		background-color: var(
			--dui-table-header-background-color,
			var(--_dui-table-header-background)
		);
		color: var(--dui-table-header-color, var(--_dui-table-header-color));
	}

	.table :global(thead > tr),
	.table :global(tbody > tr:not(:last-child)),
	.table :global(tfoot > tr) {
		border-block-end: var(--dui-table-row-border-width, 1px) solid
			var(
				--dui-table-row-border-color,
				var(--dui-color-foreground, currentColor)
			);
	}

	caption {
		text-align: start;
		font-weight: 600;
	}

	.table :global(th),
	.table :global(td) {
		padding-block: var(
			--dui-table-cell-padding-block,
			var(--dui-space-xs, var(--dui-spacing-xs, 0.5rem))
		);
		padding-inline: var(
			--dui-table-cell-padding-inline,
			var(--dui-space-xs, var(--dui-spacing-xs, 0.5rem))
		);
		text-align: start;
		vertical-align: top;
	}
</style>
