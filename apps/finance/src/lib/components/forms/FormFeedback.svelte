<script lang="ts" generics="Result,Reason">
	import Shared from 'delightful-local-first/forms/feedback-view'
	import type { ComponentProps } from 'svelte'
	import { m } from '#lib/paraglide/messages.js'
	import { formMessages } from '#lib/forms/form-messages.js'
	let props: Omit<
		ComponentProps<typeof Shared<Result, Reason>>,
		'retryLabel' | 'defaultMessages'
	> = $props()
</script>

<Shared {...props} retryLabel={m['actions.retry']()} defaultMessages={formMessages} />
