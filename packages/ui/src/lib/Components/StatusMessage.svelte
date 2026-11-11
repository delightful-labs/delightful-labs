<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLAttributes } from 'svelte/elements'
	import LoadingSpinner from './LoadingSpinner.svelte'

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
		variant?: 'info' | 'loading' | 'success' | 'error'
		/** Show a compact dot-and-label status, retaining a spinner while loading. */
		compact?: boolean
	} & (
			{ text: string; message?: Snippet } | { text?: string; message: Snippet }
		)

	let {
		text,
		message,
		variant = 'info',
		compact = false,
		role,
		class: className,
		...attributes
	}: Props = $props()
</script>

<div
	{...attributes}
	role={role ?? (variant === 'error' ? 'alert' : 'status')}
	class={['status-message', className, { compact, error: variant === 'error' }]}
>
	{#if variant === 'loading'}
		<div class="spinner" aria-hidden="true">
			<LoadingSpinner role="presentation" />
		</div>
	{:else if compact}
		<span
			class={['indicator', { success: variant === 'success' }]}
			aria-hidden="true"
		></span>
	{/if}
	<span class="message">
		{#if message}{@render message()}{:else}{text}{/if}
	</span>
</div>

<style>
	@property --dui-status-message-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-status-message-compact-font-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-status-message-error-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-status-message-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-status-message-indicator-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-status-message-spinner-border-width {
		syntax: '<length>';
		inherits: true;
		initial-value: 2px;
	}

	@property --dui-status-message-spinner-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-status-message-success-color {
		syntax: '*';
		inherits: true;
	}

	.status-message {
		--dui-loading-spinner-size: var(--dui-status-message-spinner-size, 1.5rem);
		display: flex;
		align-items: center;
		gap: var(
			--dui-status-message-gap,
			var(--dui-space-xs, var(--dui-spacing-xs, 0.5rem))
		);
		color: var(
			--dui-status-message-color,
			var(--dui-color-foreground, inherit)
		);
	}

	.status-message[hidden]:not([hidden='until-found']) {
		display: none;
	}

	.compact {
		--dui-loading-spinner-size: var(--dui-status-message-spinner-size, 1rem);
		font-size: var(
			--dui-status-message-compact-font-size,
			var(--dui-font-size-sm, 0.875rem)
		);
	}

	.indicator {
		flex: none;
		box-sizing: border-box;
		inline-size: var(--dui-status-message-indicator-size, 0.625rem);
		block-size: var(--dui-status-message-indicator-size, 0.625rem);
		border: var(--dui-border-width, 2px) solid currentColor;
		border-radius: 50%;
		background-color: currentColor;
	}

	.indicator.success {
		background-color: var(
			--dui-status-message-success-color,
			var(--dui-color-success, var(--dui-color-accent, currentColor))
		);
	}

	.error {
		color: var(
			--dui-status-message-error-color,
			var(--dui-color-error, #b91c1c)
		);
	}

	.spinner {
		flex: none;
		--dui-loading-spinner-border-width: var(
			--dui-status-message-spinner-border-width,
			2px
		);
	}

	.message {
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}
</style>
