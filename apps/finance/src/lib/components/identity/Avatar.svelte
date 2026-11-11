<script lang="ts" module>
	export type { AvatarImage } from 'delightful-local-first/profile/avatar-view'
</script>

<script lang="ts">
	import Shared from 'delightful-local-first/profile/avatar-view'
	import type { ComponentProps } from 'svelte'
	import { m } from '#lib/paraglide/messages.js'
	let {
		alt = m['images.avatar_alt'](),
		...props
	}: Omit<ComponentProps<typeof Shared>, 'alt'> & { alt?: string } = $props()
</script>

<Shared {...props} {alt} />
