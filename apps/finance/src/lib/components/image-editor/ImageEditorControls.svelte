<script lang="ts">
	import { Button, Checkbox, InputRange, Popover, Select } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import type {
		ImageEditorEvent,
		ImageEditorPresentation
	} from '#lib/machines/images/image-editor.js'

	let {
		view,
		oncommand
	}: { view: ImageEditorPresentation; oncommand: (event: ImageEditorEvent) => void } = $props()
	const contrastId = $props.id()
	const percentage = $derived(new Intl.NumberFormat(getLocale(), { style: 'percent' }))
</script>

<div class="controls">
	<Select
		label={m['image_editor.crop_mode']()}
		value={view.mode}
		disabled={!view.controls.adjust}
		onchange={(event) => {
			const mode = event.currentTarget.value
			if (mode === 'square' || mode === 'rectangle' || mode === 'perspective')
				oncommand({ type: 'SET_MODE', mode })
		}}
	>
		<option value="rectangle">{m['image_editor.rectangle']()}</option>
		<option value="perspective">{m['image_editor.perspective']()}</option>
		<option value="square">{m['image_editor.square']()}</option>
	</Select>
	<Checkbox
		label={m['image_editor.black_white']()}
		disabled={!view.controls.adjust}
		bind:checked={
			() => view.adjustments.blackWhite,
			(value) => oncommand({ type: 'SET_BLACK_WHITE', value: value ?? false })
		}
	/>
	<Button type="button" popovertarget={contrastId} disabled={!view.controls.adjust}
		>{m['image_editor.contrast']()}</Button
	>
	<Popover id={contrastId} aria-label={m['image_editor.contrast']()}>
		<InputRange
			label={m['image_editor.contrast']()}
			id={`${contrastId}-input`}
			min={0}
			max={200}
			step={1}
			disabled={!view.controls.adjust}
			bind:value={
				() => view.adjustments.contrast,
				(value) => {
					if (value !== undefined) oncommand({ type: 'SET_CONTRAST', value })
				}
			}
		/>
		<output for={`${contrastId}-input`}>{percentage.format(view.adjustments.contrast / 100)}</output
		>
	</Popover>
	<div class="actions">
		<Button
			type="button"
			disabled={!view.controls.reset}
			onclick={() => oncommand({ type: 'RESET' })}
		>
			{m['image_editor.reset']()}
		</Button>
		{#if view.controls.edit}
			<Button type="button" onclick={() => oncommand({ type: 'EDIT' })}>
				{m['image_editor.edit']()}
			</Button>
		{:else}
			<Button
				type="button"
				disabled={!view.controls.preview}
				onclick={() => oncommand({ type: 'PREVIEW' })}
			>
				{m['image_editor.preview']()}
			</Button>
		{/if}
		<Button
			type="button"
			disabled={!view.controls.cancel}
			onclick={() => oncommand({ type: 'CANCEL' })}>{m['image_editor.cancel']()}</Button
		>
		<Button
			type="button"
			variant="primary"
			disabled={!view.controls.apply}
			onclick={() => oncommand({ type: 'APPLY' })}>{m['image_editor.apply_changes']()}</Button
		>
	</div>
</div>

<style>
	.controls {
		display: grid;
		gap: var(--dui-spacing-xs, 0.5rem);
		min-width: 0;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-spacing-xs, 0.5rem);
	}
</style>
