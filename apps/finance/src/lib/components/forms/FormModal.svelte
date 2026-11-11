<script lang="ts" generics="View extends FormPresentation">
	import Shared from 'delightful-local-first/forms/modal'
	import { ButtonContent } from 'delightful-ui'
	import type { ComponentProps } from 'svelte'
	import type { FormPresentation } from '#lib/contracts/form-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'
	import SaveIcon from 'tdesign-icons-svg/src/save.svg?component'
	import CloseIcon from 'tdesign-icons-svg/src/close.svg?component'
	let props: Omit<
		ComponentProps<typeof Shared<View>>,
		'buttonContent' | 'closeLabel' | 'cancelLabel'
	> = $props()
	let modal: Shared<View> | undefined = $state()
	export function openModal() {
		modal?.openModal()
	}
	const icons = { add: AddIcon, save: SaveIcon, close: CloseIcon }
</script>

<Shared
	{...props}
	bind:this={modal}
	closeLabel={m['actions.close']()}
	cancelLabel={m['actions.cancel']()}
>
	{#snippet buttonContent(kind, text, loading)}<ButtonContent
			icon={icons[kind]}
			{text}
			{loading}
		/>{/snippet}
</Shared>
