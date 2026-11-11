<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLAttributes } from 'svelte/elements'
	import ScreenReaderText from './ScreenReaderText.svelte'

	export type StepperStep = {
		id: string
		label: string
		status?: 'upcoming' | 'current' | 'completed'
	}

	type Props = Omit<HTMLAttributes<HTMLElement>, 'aria-label'> & {
		steps: StepperStep[]
		/** Replaces the visible label; status announcements remain library-owned. */
		stepLabel?: Snippet<[StepperStep]>
		currentStep: string
		label?: string
		completedLabel?: string
		upcomingLabel?: string
	}

	let {
		steps,
		currentStep,
		stepLabel,
		label = 'Progress',
		completedLabel = 'completed',
		upcomingLabel = 'not completed',
		class: className,
		...attributes
	}: Props = $props()
</script>

<ol {...attributes} aria-label={label} class={['stepper', className]}>
	{#each steps as step, index (step.id)}
		{@const status =
			step.status ?? (step.id === currentStep ? 'current' : 'upcoming')}
		<li
			data-status={status}
			aria-current={status === 'current' ? 'step' : undefined}
		>
			<span class="step-number" aria-hidden="true">{index + 1}</span>
			<span class="step-label">
				{#if stepLabel}{@render stepLabel(step)}{:else}{step.label}{/if}
				{#if status === 'completed'}
					<ScreenReaderText>{completedLabel}</ScreenReaderText>
				{:else if status === 'upcoming'}
					<ScreenReaderText>{upcomingLabel}</ScreenReaderText>
				{/if}
			</span>
		</li>
	{/each}
</ol>

<style>
	@property --dui-stepper-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-completed-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-current-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-current-font-weight {
		syntax: '<number> | normal | bold | bolder | lighter';
		inherits: true;
		initial-value: 600;
	}

	@property --dui-stepper-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-inactive-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-inactive-text-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-item-padding-block {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-number-border-width {
		syntax: '<length> | thin | medium | thick';
		inherits: true;
		initial-value: 1px;
	}

	@property --dui-stepper-number-completed-background {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-number-completed-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-number-current-background {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-number-current-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-number-font-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-number-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-number-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-stepper-track-width {
		syntax: '*';
		inherits: true;
	}

	.stepper {
		color: var(--dui-stepper-color, var(--dui-color-foreground, inherit));
		display: flex;
		flex-wrap: wrap;
		gap: var(
			--dui-stepper-gap,
			var(--dui-space-sm, var(--dui-spacing-md, 1rem))
		);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: flex-start;
		flex: 1 1 8rem;
		min-inline-size: 0;
		padding-block-start: var(
			--dui-stepper-item-padding-block,
			var(--dui-spacing-xs, 0.5rem)
		);
		border-block-start: var(--dui-stepper-track-width, 0.25rem) solid
			var(
				--dui-stepper-inactive-color,
				color-mix(in srgb, currentColor 24%, transparent)
			);
	}

	li[data-status='current'] {
		border-color: var(
			--dui-stepper-current-color,
			var(--dui-color-accent, currentColor)
		);
		font-weight: var(--dui-stepper-current-font-weight, 600);
	}

	li[data-status='completed'] {
		border-color: var(
			--dui-stepper-completed-color,
			var(
				--dui-stepper-inactive-color,
				color-mix(in srgb, currentColor 24%, transparent)
			)
		);
	}

	.step-number {
		display: grid;
		place-items: center;
		inline-size: var(--dui-stepper-number-size, 1.75rem);
		block-size: var(--dui-stepper-number-size, 1.75rem);
		flex: 0 0 var(--dui-stepper-number-size, 1.75rem);
		margin-inline-end: var(
			--dui-stepper-number-gap,
			var(--dui-spacing-xs, 0.5rem)
		);
		border: var(--dui-stepper-number-border-width, 1px) solid currentColor;
		border-radius: 50%;
		font-size: var(
			--dui-stepper-number-font-size,
			var(--dui-font-size-sm, 0.875rem)
		);
	}

	li[data-status='current'] .step-number {
		color: var(
			--dui-stepper-number-current-color,
			var(--dui-color-on-accent, inherit)
		);
		background: var(
			--dui-stepper-number-current-background,
			var(--dui-color-accent, transparent)
		);
	}

	li[data-status='completed'] .step-number {
		color: var(--dui-stepper-number-completed-color, currentColor);
		background: var(--dui-stepper-number-completed-background, transparent);
	}

	.step-label {
		min-inline-size: 0;
		flex: 1 1 auto;
	}

	li[data-status='upcoming'] .step-label,
	li[data-status='completed'] .step-label {
		color: var(--dui-stepper-inactive-text-color, inherit);
	}

	@media (forced-colors: active) {
		li[data-status='current'],
		li[data-status='completed'] {
			border-color: currentColor;
		}
	}
</style>
