<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements'
	import ScreenReaderText from './ScreenReaderText.svelte'

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
		text?: string
	}

	let {
		text,
		role = 'status',
		class: className,
		...attributes
	}: Props = $props()
</script>

<div {...attributes} {role} class={['spinner', className]}>
	{#if text}
		<ScreenReaderText>{text}</ScreenReaderText>
	{/if}
	<div class="ring" aria-hidden="true"></div>
	<div class="ring delayed" aria-hidden="true"></div>
</div>

<style>
	@property --dui-loading-spinner-border-width {
		syntax: '<length>';
		inherits: true;
		initial-value: 4px;
	}

	@property --dui-loading-spinner-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-loading-spinner-size {
		syntax: '<length-percentage>';
		inherits: true;
		initial-value: 80px;
	}

	.spinner {
		display: block;
		position: relative;
		inline-size: var(--dui-loading-spinner-size, 80px);
		block-size: var(--dui-loading-spinner-size, 80px);
		margin-inline: auto;
		align-self: center;
		justify-self: center;
		color: var(--dui-loading-spinner-color, currentColor);
	}

	.spinner[hidden]:not([hidden='until-found']) {
		display: none;
	}

	.ring {
		box-sizing: content-box;
		position: absolute;
		border: var(--dui-loading-spinner-border-width, 4px) solid currentColor;
		border-radius: 50%;
		animation: ripple 1s cubic-bezier(0, 0.2, 0.8, 1) infinite;
	}

	.delayed {
		animation-delay: -0.5s;
	}

	@keyframes ripple {
		0%,
		4.9% {
			top: calc(50% - var(--dui-loading-spinner-border-width, 4px));
			left: calc(50% - var(--dui-loading-spinner-border-width, 4px));
			width: 0;
			height: 0;
			opacity: 0;
		}

		5% {
			top: calc(50% - var(--dui-loading-spinner-border-width, 4px));
			left: calc(50% - var(--dui-loading-spinner-border-width, 4px));
			width: 0;
			height: 0;
			opacity: 1;
		}

		100% {
			top: 0;
			left: 0;
			width: calc(100% - 2 * var(--dui-loading-spinner-border-width, 4px));
			height: calc(100% - 2 * var(--dui-loading-spinner-border-width, 4px));
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ring {
			animation: none;
			inset: 0;
			opacity: 1;
		}

		.delayed {
			display: none;
		}
	}
</style>
