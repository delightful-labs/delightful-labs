<script lang="ts">
	import StatusMessage from '#lib/Components/StatusMessage.svelte'
	let { compact = false }: { compact?: boolean } = $props()
	let variant = $state<'loading' | 'success' | 'error'>('loading')
	let hidden = $state(false)
	const text = $derived(
		variant === 'loading'
			? 'Saving changes'
			: variant === 'success'
				? 'Changes saved'
				: 'Save failed'
	)
</script>

<button onclick={() => (variant = 'success')}>Complete</button>
<button onclick={() => (variant = 'error')}>Fail</button>
<button onclick={() => (variant = 'loading')}>Retry</button>
<button onclick={() => (hidden = !hidden)}>Toggle visibility</button>
<StatusMessage id="feedback" {variant} {text} {hidden} {compact} />
