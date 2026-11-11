<script module lang="ts">
	/** Commands emitted by the keypad; the consuming application interprets them. */
	export type NumberKeypadKey =
		| '0'
		| '1'
		| '2'
		| '3'
		| '4'
		| '5'
		| '6'
		| '7'
		| '8'
		| '9'
		| 'decimal'
		| 'backspace'
		| 'next'

	const digits: NumberKeypadKey[] = [
		'1',
		'2',
		'3',
		'4',
		'5',
		'6',
		'7',
		'8',
		'9'
	]
</script>

<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements'
	import Button from './Button.svelte'

	type Props = Omit<
		HTMLAttributes<HTMLDivElement>,
		'children' | 'role' | 'aria-label'
	> & {
		label: string
		decimalLabel: string
		backspaceLabel: string
		nextLabel: string
		decimalSeparator?: string
		disabled?: boolean
		nextDisabled?: boolean

		onkey: (key: NumberKeypadKey) => void
	}

	let {
		label,
		decimalLabel,
		backspaceLabel,
		nextLabel,
		decimalSeparator = '.',
		disabled = false,
		nextDisabled = false,
		onkey,
		class: className,
		...attributes
	}: Props = $props()
</script>

<div
	{...attributes}
	class={['number-keypad', className]}
	role="group"
	aria-label={label}
>
	{#each digits as digit (digit)}
		<Button
			type="button"
			appearance="flat"
			class="number-keypad-key"
			{disabled}
			onclick={() => onkey(digit)}
		>
			{digit}
		</Button>
	{/each}
	<Button
		type="button"
		appearance="flat"
		class="number-keypad-key"
		{disabled}
		aria-label={decimalLabel}
		onclick={() => onkey('decimal')}
	>
		{decimalSeparator}
	</Button>
	<Button
		type="button"
		appearance="flat"
		class="number-keypad-key"
		{disabled}
		onclick={() => onkey('0')}
	>
		0
	</Button>
	<Button
		type="button"
		appearance="flat"
		class="number-keypad-key"
		{disabled}
		aria-label={backspaceLabel}
		onclick={() => onkey('backspace')}
	>
		<span aria-hidden="true">⌫</span>
	</Button>
	<Button
		type="button"
		variant="primary"
		appearance="flat"
		class="number-keypad-next"
		disabled={disabled || nextDisabled}
		onclick={() => onkey('next')}
	>
		{nextLabel}
	</Button>
</div>

<style>
	@property --dui-number-keypad-font-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-number-keypad-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-number-keypad-key-aspect-ratio {
		syntax: '*';
		inherits: true;
	}

	@property --dui-number-keypad-key-min-height {
		syntax: '<length-percentage>';
		inherits: true;
		initial-value: 64px;
	}

	.number-keypad {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--dui-number-keypad-gap, var(--dui-spacing-xs, 0.5rem));
		min-inline-size: 0;
	}

	.number-keypad :global(.number-keypad-key) {
		--dui-button-min-height: var(--dui-number-keypad-key-min-height, 64px);
		--dui-button-font-size: var(
			--dui-number-keypad-font-size,
			var(--dui-font-size-xxl, 1.5rem)
		);
		inline-size: 100%;
		min-inline-size: 0;
		aspect-ratio: var(--dui-number-keypad-key-aspect-ratio, 1);
	}

	.number-keypad :global(.number-keypad-next) {
		--dui-button-min-height: var(--dui-number-keypad-key-min-height, 64px);
		grid-column: 1 / -1;
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}
</style>
