<script lang="ts" generics="View extends FormPresentation">
	import { Button, Dialog } from 'delightful-ui'
	import type { Snippet } from 'svelte'
	import type { FormPresentation } from '../../contracts/scoped-form.js'
	import FormContent from './FormContent.svelte'

	let {
		buttonContent, closeLabel, cancelLabel,
		scope,
		label,
		view,
		onopen,
		onsubmit,
		onreset,
		fields,
		feedback,
		trigger,
		announcements
	}: {
		buttonContent: Snippet<['add'|'save'|'close',string,boolean]>
		closeLabel:string
		cancelLabel:string
		scope: unknown
		label: string
		view: View
		onopen: () => void
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		fields: Snippet<[View]>
		feedback: Snippet<[View]>
		announcements?: Snippet<[View]> | undefined
		trigger?: Snippet<[() => void, boolean]> | undefined
	} = $props()

	const triggerDisabled = $derived(!view.canOpen)

	export function openModal() {
		if (triggerDisabled) return
		onopen()
		open = true
	}

	let open = $state(false)
	$effect(() => {
		void scope
		open = false
	})
</script>

{#if trigger}
	{@render trigger(openModal, triggerDisabled)}
{:else}
	<Button type="button" disabled={triggerDisabled} onclick={openModal}>
		{@render buttonContent('add',label,false)}
	</Button>
{/if}

<Dialog heading={label} bind:open closedby="any">
	{@render announcements?.(view)}
	{#key scope}
		{#if view.content.kind === 'success'}
			{@render feedback(view)}
			<Button type="button" variant="primary" onclick={() => (open = false)}>
				{@render buttonContent('close',closeLabel,false)}
			</Button>
		{:else}
			<FormContent controlsFill {view} {onsubmit} {onreset} {fields} {feedback}>
				{#snippet controls(form)}
					<Button type="button" onclick={() => (open = false)}>
						{@render buttonContent('close',form.activity.kind === 'idle' ? cancelLabel : closeLabel,false)}
					</Button>
					<Button
						type="submit"
						variant="primary"
						disabled={!form.canSubmit}
						aria-busy={form.activity.kind !== 'idle'}
					>
						{@render buttonContent('save',label,form.activity.kind !== 'idle')}
					</Button>
				{/snippet}
			</FormContent>
		{/if}
	{/key}
</Dialog>
