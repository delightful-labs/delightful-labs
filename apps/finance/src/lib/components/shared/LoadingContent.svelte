<script lang="ts">
	import { LoadingContent as SharedLoadingContent } from 'delightful-ui'
	import type { ComponentProps } from 'svelte'

	let props: ComponentProps<typeof SharedLoadingContent> = $props()
</script>

<SharedLoadingContent {...props} />
