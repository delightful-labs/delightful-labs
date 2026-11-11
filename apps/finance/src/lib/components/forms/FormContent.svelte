<script lang="ts" generics="View extends FormPresentation">
	import Shared from 'delightful-local-first/forms/content'
	import type { ComponentProps } from 'svelte'
	import type { FormPresentation } from '#lib/contracts/form-contract.js'
	let props: ComponentProps<typeof Shared<View>> = $props()
</script>

<Shared {...props} />
